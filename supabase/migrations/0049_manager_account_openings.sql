begin;

-- This is the date agreed for manager-entered opening figures, independent of
-- the release activation timestamp and any prior service-only rehearsal seeds.
create table public.club_account_opening_cutover (
 club_id uuid primary key references public.clubs(id),
 effective_on date not null check(isfinite(effective_on)),
 recorded_by uuid not null,
 recorded_at timestamptz not null default now()
);
alter table public.club_account_opening_cutover enable row level security;
revoke all on public.club_account_opening_cutover from public,anon,authenticated,service_role;
create trigger club_account_opening_cutover_immutable before update or delete on public.club_account_opening_cutover
 for each row execute function public.reject_financial_mutation();

create function public.record_account_opening(p_request_id uuid,p_profile_id uuid,p_amount_pence integer,p_effective_on date)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 club uuid:=public.payments_manager_club(true);
 actor uuid:=auth.uid();
 payload jsonb;
 prior public.account_entries;
 agreed_date date;
begin
 if p_request_id is null or p_profile_id is null or p_amount_pence is null or p_amount_pence=-2147483648
  or p_effective_on is null or not isfinite(p_effective_on) then
  raise exception 'Enter a valid opening balance and effective date' using errcode='22023';
 end if;
 payload:=jsonb_build_object('club_id',club,'profile_id',p_profile_id,'actor_id',actor,'kind','opening',
  'amount_pence',p_amount_pence,'source','opening','source_id','manager-opening:'||p_request_id::text,
  'description','Opening balance','occurred_on',p_effective_on);
 -- Check the stable source before current membership/activity. A saved exact
 -- request remains acknowledged even after subsequent financial activity.
 select * into prior from public.account_entries where club_id=club and source='opening'
  and source_id='manager-opening:'||p_request_id::text;
 if found then
  if prior.request_payload is distinct from payload then
   raise exception 'Opening reference already used for different figures' using errcode='22023';
  end if;
  return prior.id;
 end if;
 if not exists(select 1 from public.profiles where id=p_profile_id and club_id=club and is_player and approved and active) then
  raise exception 'Player is outside the active club squad' using errcode='42501';
 end if;
 if exists(select 1 from public.account_entries e join public.player_accounts a on a.id=e.account_id
  where a.club_id=club and a.profile_id=p_profile_id) then
  raise exception 'An opening balance can only be the first account entry' using errcode='22023';
 end if;
 select effective_on into agreed_date from public.club_account_opening_cutover where club_id=club;
 if found then
  if agreed_date<>p_effective_on then
   raise exception 'Use the club opening balance effective date' using errcode='22023';
  end if;
 else
  insert into public.club_account_opening_cutover(club_id,effective_on,recorded_by) values(club,p_effective_on,actor);
 end if;
 return public.post_account_entry(payload);
end; $$;

create function public.get_account_opening_summary(p_effective_on date default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 club uuid:=public.payments_manager_club(false);
 summary jsonb;
begin
 if p_effective_on is not null and not isfinite(p_effective_on) then
  raise exception 'Enter a valid opening effective date' using errcode='22023';
 end if;
 select jsonb_build_object(
  'effective_on',(select effective_on from public.club_account_opening_cutover where club_id=club),
  'filter_effective_on',p_effective_on,
  'account_count',count(*),
  'credit_count',count(*) filter(where e.amount_pence>0),
  'arrears_count',count(*) filter(where e.amount_pence<0),
  'settled_count',count(*) filter(where e.amount_pence=0),
  'opening_credit_pence',coalesce(sum(e.amount_pence::bigint) filter(where e.amount_pence>0),0),
  'opening_arrears_pence',coalesce(sum(-e.amount_pence::bigint) filter(where e.amount_pence<0),0),
  'net_opening_pence',coalesce(sum(e.amount_pence::bigint),0),
  'entries',coalesce(jsonb_agg(jsonb_build_object('id',e.id,'profile_id',a.profile_id,'player_name',a.player_name,
    'amount_pence',e.amount_pence,'effective_on',e.occurred_on,'posted_at',e.posted_at)
    order by e.occurred_on,e.sequence) filter(where e.id is not null),'[]'::jsonb)) into summary
 from public.account_entries e join public.player_accounts a on a.id=e.account_id and a.club_id=e.club_id
 where e.club_id=club and e.kind='opening' and (p_effective_on is null or e.occurred_on=p_effective_on);
 return summary;
end; $$;

revoke all on function public.record_account_opening(uuid,uuid,integer,date),public.get_account_opening_summary(date)
 from public,anon,authenticated,service_role;
grant execute on function public.record_account_opening(uuid,uuid,integer,date),public.get_account_opening_summary(date) to authenticated;
comment on function public.record_account_opening(uuid,uuid,integer,date) is
 'Approved club manager opening figure: positive credit, negative arrears, zero settled. First account entry only; exact request retries return the original. First successful manager figure pins the immutable club effective date. Never reconstructs historical paid ticks.';
comment on function public.get_account_opening_summary(date) is
 'Original opening figures, separate absolute credit and arrears totals, inclusive of service-imported openings. Optional exact London-date filter; effective_on always exposes the independently agreed manager cutover date. Receipts and later corrections never change these signed cutover figures.';
commit;
