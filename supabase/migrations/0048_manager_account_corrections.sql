begin;

-- One immutable request receipt covers every manager correction operation.
-- In particular the wrong-player reversal, replacement and result commit together.
create table public.manager_account_requests (
 club_id uuid not null references public.clubs(id),
 request_id uuid not null,
 actor_id uuid not null,
 operation text not null check(operation in ('fine','adjustment','reversal','wrong_player')),
 payload jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key(club_id,request_id)
);
alter table public.manager_account_requests enable row level security;
revoke all on public.manager_account_requests from public,anon,authenticated,service_role;
grant select on public.manager_account_requests to authenticated;
create policy manager_account_requests_read on public.manager_account_requests for select to authenticated
 using(club_id=(select public.current_club_id()) and (select public.is_admin(auth.uid()))
  and (select public.is_approved_member(auth.uid())) and public.can_read_player_account(club_id,null::uuid));
create trigger manager_account_requests_immutable before update or delete on public.manager_account_requests
 for each row execute function public.reject_financial_mutation();

create function public.manager_account_change(p_request_id uuid,p_operation text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 club uuid:=public.payments_manager_club(true);
 actor uuid:=auth.uid();
 prior public.manager_account_requests;
 original public.account_entries;
 original_account public.player_accounts;
 player uuid:=(p_payload->>'profile_id')::uuid;
 original_id uuid:=(p_payload->>'entry_id')::uuid;
 reason text:=btrim(p_payload->>'reason');
 accounting_date date:=coalesce((p_payload->>'occurred_on')::date,(now() at time zone 'Europe/London')::date);
 amount integer:=(p_payload->>'amount_pence')::integer;
 entry uuid; reversal uuid; replacement uuid; outcome jsonb; base jsonb;
 source_prefix text:='manager:'||p_request_id::text;
begin
 if p_request_id is null or p_operation is null or p_operation not in ('fine','adjustment','reversal','wrong_player')
  or reason is null or length(reason) not between 1 and 900 or not isfinite(accounting_date) then
  raise exception 'Enter a reason and a valid accounting date' using errcode='22023';
 end if;
 select * into prior from public.manager_account_requests where club_id=club and request_id=p_request_id;
 if found then
  if prior.actor_id is distinct from actor or prior.operation is distinct from p_operation or prior.payload is distinct from p_payload then
   raise exception 'Request reference already used for a different change' using errcode='22023';
  end if;
  return prior.result;
 end if;
 if p_operation in ('fine','adjustment','wrong_player') then
  if player is null or not exists(select 1 from public.profiles where id=player and club_id=club and is_player and approved and active) then
   raise exception 'Player is outside the active club squad' using errcode='42501';
  end if;
 end if;
 if p_operation in ('fine','adjustment') then
  if amount is null or amount=0 or amount=-2147483648 or (p_operation='fine' and amount<0) then
   raise exception 'Enter a valid non-zero amount in pence' using errcode='22023';
  end if;
  base:=jsonb_build_object('club_id',club,'profile_id',player,'actor_id',actor,'occurred_on',accounting_date,
   'amount_pence',case when p_operation='fine' then -amount else amount end,
   'kind',case when p_operation='fine' then 'charge' else 'adjustment' end,
   'source',p_operation,'source_id',source_prefix||':entry',
   'description',case when p_operation='fine' then 'Fine: ' else 'Adjustment: ' end||reason);
  if p_operation='fine' then
   base:=base||jsonb_build_object('category','fines','activity_type','fine','activity_id',p_request_id,
    'activity_snapshot',jsonb_build_object('reason',reason,'date',accounting_date));
  end if;
  entry:=public.post_account_entry(base);
  outcome:=jsonb_build_object('entry_id',entry);
 else
  select * into original from public.account_entries where id=original_id and club_id=club;
  if not found then raise exception 'Original entry is outside this club' using errcode='42501'; end if;
  select * into original_account from public.player_accounts where id=original.account_id and club_id=club;
  if original.kind='reversal' or original.source in ('stripe_payment','stripe_refund') then
   raise exception 'This entry cannot be manually reversed' using errcode='22023';
  end if;
  if exists(select 1 from public.account_entries where linked_entry_id=original.id and kind='reversal') then
   raise exception 'This entry has already been reversed' using errcode='22023';
  end if;
  if p_operation='wrong_player' and (original.kind<>'receipt' or original.source not in ('cash','bank')
    or original_account.profile_id=player) then
   raise exception 'Choose a different player for a cash or bank receipt' using errcode='22023';
  end if;
  reversal:=public.post_account_entry(jsonb_build_object('club_id',club,'profile_id',original_account.profile_id,
   'actor_id',actor,'occurred_on',accounting_date,'kind','reversal','amount_pence',-original.amount_pence,
   'source','reversal','source_id',source_prefix||':reversal','description','Reversal: '||reason,'linked_entry_id',original.id));
  if p_operation='wrong_player' then
   replacement:=public.post_account_entry(jsonb_build_object('club_id',club,'profile_id',player,'actor_id',actor,
    'occurred_on',accounting_date,'kind','receipt','amount_pence',original.amount_pence,'source',original.source,
    'source_id',source_prefix||':replacement','reference',original.reference,
    'description','Receipt correction: '||reason));
   outcome:=jsonb_build_object('original_entry_id',original.id,'reversal_entry_id',reversal,'receipt_entry_id',replacement);
  else
   outcome:=jsonb_build_object('entry_id',reversal);
  end if;
 end if;
 insert into public.manager_account_requests(club_id,request_id,actor_id,operation,payload,result)
 values(club,p_request_id,actor,p_operation,p_payload,outcome);
 return outcome;
end; $$;

create function public.record_account_fine(p_request_id uuid,p_profile_id uuid,p_amount_pence integer,p_reason text,p_occurred_on date default null)
returns uuid language sql security definer set search_path=pg_catalog,public as $$
 select (public.manager_account_change(p_request_id,'fine',jsonb_build_object('profile_id',p_profile_id,
 'amount_pence',p_amount_pence,'reason',p_reason,'occurred_on',p_occurred_on))->>'entry_id')::uuid;
$$;
create function public.record_account_adjustment(p_request_id uuid,p_profile_id uuid,p_amount_pence integer,p_reason text,p_occurred_on date default null)
returns uuid language sql security definer set search_path=pg_catalog,public as $$
 select (public.manager_account_change(p_request_id,'adjustment',jsonb_build_object('profile_id',p_profile_id,
 'amount_pence',p_amount_pence,'reason',p_reason,'occurred_on',p_occurred_on))->>'entry_id')::uuid;
$$;
create function public.reverse_account_entry(p_request_id uuid,p_entry_id uuid,p_reason text,p_occurred_on date default null)
returns uuid language sql security definer set search_path=pg_catalog,public as $$
 select (public.manager_account_change(p_request_id,'reversal',jsonb_build_object('entry_id',p_entry_id,
 'reason',p_reason,'occurred_on',p_occurred_on))->>'entry_id')::uuid;
$$;
create function public.correct_manual_receipt_player(p_request_id uuid,p_entry_id uuid,p_profile_id uuid,p_reason text,p_occurred_on date default null)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
 select public.manager_account_change(p_request_id,'wrong_player',jsonb_build_object('entry_id',p_entry_id,
 'profile_id',p_profile_id,'reason',p_reason,'occurred_on',p_occurred_on));
$$;
revoke all on function public.manager_account_change(uuid,text,jsonb),
 public.record_account_fine(uuid,uuid,integer,text,date),public.record_account_adjustment(uuid,uuid,integer,text,date),
 public.reverse_account_entry(uuid,uuid,text,date),public.correct_manual_receipt_player(uuid,uuid,uuid,text,date)
 from public,anon,authenticated,service_role;
grant execute on function public.record_account_fine(uuid,uuid,integer,text,date),
 public.record_account_adjustment(uuid,uuid,integer,text,date),public.reverse_account_entry(uuid,uuid,text,date),
 public.correct_manual_receipt_player(uuid,uuid,uuid,text,date) to authenticated;
comment on table public.manager_account_requests is 'Append-only manager correction audit, including original/reversal/replacement links for atomic wrong-player receipt moves. RLS exposes only the enabled club to its managers.';
commit;
