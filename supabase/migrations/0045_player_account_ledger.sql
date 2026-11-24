begin;

-- Financial records deliberately use immutable UUID snapshots, not cascading
-- fixture/profile FKs: deleting operational data must never delete the books.
create table public.club_payments_release (
 club_id uuid primary key references public.clubs(id),
 enabled boolean not null default false,
 cutover_at timestamptz,
 changed_at timestamptz not null default now(),
 check (not enabled or cutover_at is not null)
);
create table public.player_accounts (
 id uuid primary key default gen_random_uuid(),
 club_id uuid not null references public.clubs(id),
 profile_id uuid not null,
 player_name text not null,
 created_at timestamptz not null default now(),
 unique(club_id,profile_id)
);
create table public.account_entries (
 id uuid primary key default gen_random_uuid(),
 sequence bigint generated always as identity unique,
 account_id uuid not null references public.player_accounts(id),
 club_id uuid not null references public.clubs(id),
 kind text not null check(kind in ('opening','charge','receipt','refund','adjustment','reversal')),
 amount_pence integer not null check(amount_pence > -2147483648),
 description text not null check(length(btrim(description)) between 1 and 1000),
 reference text not null default '' check(length(reference)<=300),
 category text check(category in ('first_team','community','training','fines')),
 activity_type text check(activity_type in ('fixture','training_session','fine')),
 activity_id uuid,
 activity_snapshot jsonb not null default '{}' check(jsonb_typeof(activity_snapshot)='object'),
 linked_entry_id uuid references public.account_entries(id),
 actor_id uuid,
 source text not null,
 source_id text not null check(length(btrim(source_id)) between 1 and 300),
 occurred_on date not null check(isfinite(occurred_on)),
 posted_at timestamptz not null default now(),
 request_payload jsonb not null,
 unique(club_id,source,source_id),
 check ((kind='charge' and amount_pence<0 and category is not null and activity_type is not null and activity_id is not null)
  or (kind='receipt' and amount_pence>0 and category is null and linked_entry_id is null)
  or (kind='refund' and amount_pence<0 and category is null and linked_entry_id is not null)
  or (kind in ('opening','adjustment') and category is null and linked_entry_id is null and (kind='opening' or amount_pence<>0))
  or (kind='reversal' and linked_entry_id is not null)),
 check (kind in ('charge','reversal') or (activity_type is null and activity_id is null and activity_snapshot='{}'::jsonb))
);
create index account_entries_account_order on public.account_entries(account_id,sequence);
create unique index account_entries_one_reversal on public.account_entries(linked_entry_id) where kind='reversal';
-- Manual receipt request identities span both methods: changing cash to bank
-- under the same request is a conflict, never a second genuine receipt.
create unique index account_entries_manual_request on public.account_entries(club_id,source_id) where source in ('cash','bank');
create unique index account_entries_one_opening on public.account_entries(account_id) where kind='opening';
create index account_entries_linked on public.account_entries(linked_entry_id);

create table public.legacy_payment_history (
 id bigint generated always as identity primary key,
 club_id uuid not null references public.clubs(id),
 payment_id uuid not null,
 profile_id uuid not null,
 player_name text not null,
 fixture_id uuid not null,
 fixture_snapshot jsonb not null,
 paid boolean not null,
 operation text not null,
 recorded_at timestamptz not null default now()
);
create index legacy_payment_history_payment_idx on public.legacy_payment_history(payment_id,id desc);
insert into public.legacy_payment_history(club_id,payment_id,profile_id,player_name,fixture_id,fixture_snapshot,paid,operation)
 select f.club_id,p.id,p.profile_id,concat_ws(' ',u.first_name,u.last_name),p.fixture_id,to_jsonb(f),p.paid,'baseline'
 from public.payments p join public.fixtures f on f.id=p.fixture_id join public.profiles u on u.id=p.profile_id;

create function public.reject_financial_mutation() returns trigger
 language plpgsql set search_path=public as $$
begin raise exception 'Financial history is append-only' using errcode='42501'; end; $$;
create trigger account_entries_immutable before update or delete on public.account_entries
 for each row execute function public.reject_financial_mutation();
create trigger player_accounts_immutable before update or delete on public.player_accounts
 for each row execute function public.reject_financial_mutation();
create trigger legacy_payment_history_immutable before update or delete on public.legacy_payment_history
 for each row execute function public.reject_financial_mutation();

create function public.archive_legacy_payment() returns trigger
 language plpgsql security definer set search_path=public as $$
declare v public.payments; f public.fixtures; n text; c uuid;
begin
 if TG_OP='DELETE' then v:=old; else v:=new; end if;
 select * into f from public.fixtures where id=v.fixture_id;
 c:=f.club_id;
 -- During cascade deletion the fixture can already be absent. Reuse the
 -- immutable snapshot captured on migration/insert, never drop the history.
 if c is null then
  select club_id into c from public.legacy_payment_history where payment_id=v.id order by id desc limit 1;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('payments:'||c::text,0));
 if TG_OP<>'DELETE' and exists(select 1 from public.club_payments_release where club_id=c and cutover_at is not null) then
  raise exception 'Per-match paid ticks were retired at account cutover' using errcode='42501';
 end if;
 select concat_ws(' ',first_name,last_name) into n from public.profiles where id=v.profile_id;
 insert into public.legacy_payment_history(club_id,payment_id,profile_id,player_name,fixture_id,fixture_snapshot,paid,operation)
 values(c,v.id,v.profile_id,coalesce(n,'Former player'),v.fixture_id,
 coalesce(case when f.id is not null then to_jsonb(f) end, (select fixture_snapshot from public.legacy_payment_history where payment_id=v.id order by id desc limit 1)),v.paid,lower(TG_OP));
 if TG_OP='DELETE' then return old; end if; return new;
end; $$;
create trigger payments_archive before insert or update or delete on public.payments
 for each row execute function public.archive_legacy_payment();

-- Owner-controlled release state lives outside existing browser column grants.
create function public.set_club_payments_release(p_club_id uuid,p_enabled boolean,p_cutover boolean default false)
 returns void language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('payments:'||p_club_id::text,0));
 if p_enabled is null or p_cutover is null then raise exception 'Explicit release state required' using errcode='22023'; end if;
 insert into public.club_payments_release(club_id,enabled,cutover_at)
 values(p_club_id,p_enabled,coalesce((select cutover_at from public.club_payments_release where club_id=p_club_id),case when p_cutover then now() end))
 on conflict(club_id) do update set enabled=excluded.enabled,
 cutover_at=coalesce(club_payments_release.cutover_at,excluded.cutover_at),changed_at=now();
end; $$;
create function public.payments_release_status() returns jsonb
 language sql stable security definer set search_path=public as $$
 select jsonb_build_object('enabled',coalesce((select enabled from public.club_payments_release where club_id=public.current_club_id()),false),
 'cutover_at',(select cutover_at from public.club_payments_release where club_id=public.current_club_id()));
$$;
create function public.can_read_player_account(p_club uuid,p_profile uuid) returns boolean
 language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.profiles p join public.club_payments_release r on r.club_id=p.club_id
 where p.id=auth.uid() and p.club_id=p_club and p.active and (p.approved or public.is_admin(p.id)) and r.enabled
 and (public.is_admin(p.id) or (p.id=p_profile and p.is_player)));
$$;

-- The only generic writer. Trusted provider code must verify the raw signed
-- event/account before calling this service-only RPC. A payout is NOT a receipt.
-- Request JSON is retained verbatim: an exact replay returns the original id;
-- changing any field under an existing source identity fails, never overwrites.
create function public.post_account_entry(p_entry jsonb) returns uuid
 language plpgsql security definer set search_path=public as $$
declare
 c uuid:=(p_entry->>'club_id')::uuid; p uuid:=(p_entry->>'profile_id')::uuid;
 k text:=p_entry->>'kind'; s text:=p_entry->>'source'; sid text:=p_entry->>'source_id';
 a integer; account public.player_accounts; prior public.account_entries; original public.account_entries;
 result_id uuid; cat text:=p_entry->>'category'; activity text:=p_entry->>'activity_type';
 aid uuid:=(p_entry->>'activity_id')::uuid; snapshot jsonb:=coalesce(p_entry->'activity_snapshot','{}');
 linked uuid:=(p_entry->>'linked_entry_id')::uuid; name text; total bigint;
begin
 if c is null or p is null or k is null or s is null or sid is null or length(btrim(sid))=0
 or coalesce(p_entry->>'amount_pence','') !~ '^-?[0-9]+$'
 or coalesce(length(btrim(p_entry->>'description')),0)=0 then
  raise exception 'Incomplete financial entry' using errcode='22023';
 end if;
 a:=(p_entry->>'amount_pence')::integer;
 if not ((k='opening' and s='opening') or (k='charge' and s in ('match','training','fine'))
 or (k='receipt' and s in ('cash','bank','stripe_payment')) or (k='refund' and s='stripe_refund')
 or (k='adjustment' and s='adjustment') or (k='reversal' and s='reversal')) then
  raise exception 'Unsupported financial source or kind' using errcode='22023';
 end if;
 -- One club lock serialises release transitions, same-source concurrent retries,
 -- linked corrections and refunds. No read-modify-write balance is stored.
 perform pg_advisory_xact_lock(hashtextextended('payments:'||c::text,0));
 select * into prior from public.account_entries where club_id=c and source_id=sid
  and (source=s or (s in ('cash','bank') and source in ('cash','bank')));
 if found then
  if prior.request_payload is distinct from p_entry then raise exception 'Source reference already used for a different entry' using errcode='22023'; end if;
  return prior.id;
 end if;
 if k<>'opening' and not (k='receipt' and s='stripe_payment') and not (k='refund' and s='stripe_refund')
 and not coalesce((select enabled from public.club_payments_release where club_id=c),false) then
  raise exception 'Player accounts are unavailable' using errcode='42501';
 end if;
 select * into account from public.player_accounts where club_id=c and profile_id=p;
 if not found then
  select concat_ws(' ',first_name,last_name) into name from public.profiles where id=p and club_id=c and is_player;
  if not found then raise exception 'Player is outside this club' using errcode='42501'; end if;
  insert into public.player_accounts(club_id,profile_id,player_name) values(c,p,name) returning * into account;
 end if;
 if linked is not null then
  select * into original from public.account_entries where id=linked and account_id=account.id and club_id=c;
  if not found then raise exception 'Linked entry is outside this account' using errcode='22023'; end if;
 end if;
 if k='reversal' then
  if linked is null or (original.kind='reversal' or original.source in ('stripe_payment','stripe_refund')) or a::bigint<>-original.amount_pence::bigint then
   raise exception 'Reversal must undo one original entry exactly' using errcode='22023';
  end if;
  if original.kind='receipt' and exists(select 1 from public.account_entries where linked_entry_id=original.id and kind='refund') then
   raise exception 'Refunded receipts cannot also be reversed' using errcode='22023';
  end if;
  cat:=original.category; activity:=original.activity_type; aid:=original.activity_id; snapshot:=original.activity_snapshot;
 elsif k='refund' then
  if linked is null or original.kind<>'receipt' or original.source<>'stripe_payment'
   or exists(select 1 from public.account_entries where linked_entry_id=original.id and kind='reversal') then
   raise exception 'Refund requires an unreversed Stripe receipt' using errcode='22023';
  end if;
  select coalesce(-sum(e.amount_pence::bigint),0) into total from public.account_entries e
   where e.linked_entry_id=original.id and e.kind='refund'
    and not exists(select 1 from public.account_entries r where r.linked_entry_id=e.id and r.kind='reversal');
  if total-a::bigint>original.amount_pence then raise exception 'Refund exceeds receipt' using errcode='22023'; end if;
 end if;
 if k='charge' then
  if (s='match' and (activity<>'fixture' or cat not in ('first_team','community')))
   or (s='training' and (activity<>'training_session' or cat<>'training'))
   or (s='fine' and (activity<>'fine' or cat<>'fines')) or snapshot='{}'::jsonb then
   raise exception 'Charge needs an original activity snapshot and category' using errcode='22023';
  end if;
  if activity='fixture' and not exists(select 1 from public.fixtures where id=aid and club_id=c)
   or activity='training_session' and not exists(select 1 from public.training_sessions where id=aid and club_id=c) then
   raise exception 'Activity is outside this club' using errcode='42501';
  end if;
 end if;
 insert into public.account_entries(account_id,club_id,kind,amount_pence,description,reference,category,
 activity_type,activity_id,activity_snapshot,linked_entry_id,actor_id,source,source_id,occurred_on,request_payload)
 values(account.id,c,k,a,p_entry->>'description',coalesce(p_entry->>'reference',''),cat,activity,aid,snapshot,linked,
 (p_entry->>'actor_id')::uuid,s,sid,coalesce((p_entry->>'occurred_on')::date,(now() at time zone 'Europe/London')::date),p_entry)
 returning id into result_id;
 return result_id;
end; $$;

create function public.record_account_receipt(p_request_id uuid,p_profile_id uuid,p_amount_pence integer,p_method text,
 p_reference text default '',p_received_on date default null,p_description text default null)
 returns uuid language plpgsql security definer set search_path=public as $$
declare c uuid:=public.current_club_id(); actor uuid:=auth.uid();
begin
 if actor is null or not public.is_admin(actor) then
  raise exception 'Only a club manager can record a receipt' using errcode='42501'; end if;
 if not coalesce((select enabled from public.club_payments_release where club_id=c),false) then
  raise exception 'Player accounts are unavailable' using errcode='42501'; end if;
 if p_request_id is null or p_profile_id is null or p_amount_pence is null or p_amount_pence<=0
 or p_method is null or p_method not in ('cash','bank') or p_reference is null then
  raise exception 'Enter a valid receipt' using errcode='22023'; end if;
 if not exists(select 1 from public.profiles where id=p_profile_id and club_id=c and is_player and approved and active) then
  raise exception 'Player is outside the active club squad' using errcode='42501'; end if;
 return public.post_account_entry(jsonb_build_object('club_id',c,'profile_id',p_profile_id,'kind','receipt',
 'amount_pence',p_amount_pence,'source',p_method,'source_id',p_request_id,'reference',p_reference,
 'description',coalesce(nullif(btrim(p_description),''),case p_method when 'cash' then 'Cash receipt' else 'Bank transfer' end),
 'occurred_on',p_received_on,'actor_id',actor));
end; $$;

create function public.get_player_account(p_profile_id uuid default auth.uid()) returns jsonb
 language plpgsql stable security definer set search_path=public as $$
declare c uuid:=public.current_club_id(); account public.player_accounts; name text; rows jsonb; balance bigint;
begin
 if not public.can_read_player_account(c,p_profile_id) then raise exception 'Account access refused' using errcode='42501'; end if;
 select * into account from public.player_accounts where club_id=c and profile_id=p_profile_id;
 if not found then
  select concat_ws(' ',first_name,last_name) into name from public.profiles where id=p_profile_id and club_id=c and is_player;
  if not found then raise exception 'Player account not found' using errcode='42501'; end if;
 end if;
 select coalesce(jsonb_agg(to_jsonb(e)-'request_payload'-'account_id'-'club_id'-case when public.is_admin(auth.uid()) then '__no_column__' else 'actor_id' end order by sequence),'[]'::jsonb),
 coalesce(sum(amount_pence::bigint),0) into rows,balance
 from (select e.*,sum(e.amount_pence::bigint) over(order by e.sequence) running_balance_pence
 from public.account_entries e where e.account_id=account.id) e;
 return jsonb_build_object('account_id',account.id,'profile_id',p_profile_id,'player_name',coalesce(account.player_name,name),
 'balance_pence',balance,'entries',rows);
end; $$;

alter table public.club_payments_release enable row level security;
alter table public.player_accounts enable row level security;
alter table public.account_entries enable row level security;
alter table public.legacy_payment_history enable row level security;
revoke all on public.club_payments_release,public.player_accounts,public.account_entries,public.legacy_payment_history from public,anon,authenticated,service_role;
grant select on public.player_accounts,public.legacy_payment_history to authenticated;
-- Column grants keep internal request payloads and actor attribution out of player REST reads.
grant select(id,sequence,account_id,club_id,kind,amount_pence,description,reference,category,activity_type,activity_id,activity_snapshot,linked_entry_id,source,source_id,occurred_on,posted_at) on public.account_entries to authenticated;
grant select on public.player_accounts,public.account_entries,public.legacy_payment_history,public.club_payments_release to service_role;
grant usage,select on sequence public.account_entries_sequence_seq,public.legacy_payment_history_id_seq to service_role;
create policy player_accounts_read on public.player_accounts for select to authenticated
 using (public.can_read_player_account(club_id,profile_id));
create policy account_entries_read on public.account_entries for select to authenticated
 using (exists(select 1 from public.player_accounts a where a.id=account_id and public.can_read_player_account(a.club_id,a.profile_id)));
create policy legacy_payment_history_read on public.legacy_payment_history for select to authenticated
 using(club_id=(select public.current_club_id()) and (select public.is_approved_member(auth.uid()))
 and (select public.is_admin(auth.uid())));
revoke all on function public.reject_financial_mutation(),public.archive_legacy_payment(),
 public.set_club_payments_release(uuid,boolean,boolean),public.post_account_entry(jsonb) from public,anon,authenticated;
grant execute on function public.set_club_payments_release(uuid,boolean,boolean),public.post_account_entry(jsonb) to service_role;
revoke all on function public.payments_release_status(),public.can_read_player_account(uuid,uuid),
 public.record_account_receipt(uuid,uuid,integer,text,text,date,text),public.get_player_account(uuid) from public,anon;
grant execute on function public.payments_release_status(),public.can_read_player_account(uuid,uuid),
 public.record_account_receipt(uuid,uuid,integer,text,text,date,text),public.get_player_account(uuid) to authenticated,service_role;

comment on table public.account_entries is 'Append-only GBP pence. Positive is player credit. Payouts never enter this table. UUID activity/profile/actor snapshots intentionally survive operational deletion.';
comment on function public.post_account_entry(jsonb) is 'Service-only financial posting. Caller verifies provider settlement/refund before posting. Stable club/source/source_id identifies one genuine entry; full JSON equality enforces exact replay. Provider receipts/refunds may settle while release is disabled.';
commit;
