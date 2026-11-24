begin;

-- Current attendance is a projection; request receipts and the ledger retain
-- the immutable audit. Activity/profile UUIDs survive operational deletion.
create table public.activity_attendance_registers (
 club_id uuid not null references public.clubs(id),
 activity_type text not null check(activity_type in ('fixture','training_session')),
 activity_id uuid not null,
 revision integer not null default 0 check(revision>=0),
 occurrence_fingerprint text not null,
 confirmed_by uuid,
 confirmed_at timestamptz,
 primary key(club_id,activity_type,activity_id)
);
create table public.activity_attendance_members (
 club_id uuid not null,
 activity_type text not null,
 activity_id uuid not null,
 profile_id uuid not null,
 player_name text not null,
 confirmed boolean not null,
 cycle integer not null check(cycle>0),
 charge_entry_id uuid references public.account_entries(id),
 fee_amount_pence integer not null check(fee_amount_pence>=0),
 fee_rate_id uuid not null,
 primary key(club_id,activity_type,activity_id,profile_id),
 foreign key(club_id,activity_type,activity_id) references public.activity_attendance_registers(club_id,activity_type,activity_id)
);
create table public.activity_attendance_requests (
 club_id uuid not null references public.clubs(id),
 request_id uuid not null,
 actor_id uuid not null,
 payload jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key(club_id,request_id)
);
alter table public.activity_attendance_registers enable row level security;
alter table public.activity_attendance_members enable row level security;
alter table public.activity_attendance_requests enable row level security;
revoke all on public.activity_attendance_registers,public.activity_attendance_members,public.activity_attendance_requests
 from public,anon,authenticated,service_role;
create trigger activity_attendance_requests_immutable before update or delete on public.activity_attendance_requests
 for each row execute function public.reject_financial_mutation();

-- Private shared difference engine. Only the occurrence-specific wrapper may
-- establish playable state, eligibility, locks, date/category and fee rate.
create function public.apply_confirmed_activity_members(p_club uuid,p_activity_type text,p_activity_id uuid,
 p_profiles uuid[],p_category text,p_date date,p_rate public.club_fee_rates,p_snapshot jsonb,p_actor uuid,p_request uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 member public.activity_attendance_members;
 original public.account_entries;
 profile uuid; player_name text; entry_id uuid;
 label text:=case p_activity_type when 'fixture' then 'Match appearance' else 'Training attendance' end;
 source_name text:=case p_activity_type when 'fixture' then 'match' else 'training' end;
begin
 for member in select * from public.activity_attendance_members where club_id=p_club and activity_type=p_activity_type
  and activity_id=p_activity_id and confirmed and not(profile_id=any(p_profiles))
 loop
  if member.charge_entry_id is not null then
   select * into original from public.account_entries where id=member.charge_entry_id and club_id=p_club;
   -- An administrative waiver is already the one linked negation. Removing
   -- attendance must not reverse it again or recreate the waived debit.
   if not exists(select 1 from public.account_entries where linked_entry_id=original.id and kind='reversal') then
    perform public.post_account_entry(jsonb_build_object('club_id',p_club,'profile_id',member.profile_id,
     'actor_id',p_actor,'kind','reversal','amount_pence',-original.amount_pence,'source','reversal',
     'source_id','attendance:'||p_request::text||':remove:'||member.profile_id::text,
     'description',label||' removed','linked_entry_id',original.id,
     'occurred_on',(now() at time zone 'Europe/London')::date));
   end if;
  end if;
  update public.activity_attendance_members set confirmed=false
   where club_id=p_club and activity_type=p_activity_type and activity_id=p_activity_id and profile_id=member.profile_id;
 end loop;
 for profile in select unnest(p_profiles)
 loop
  select * into member from public.activity_attendance_members where club_id=p_club and activity_type=p_activity_type
   and activity_id=p_activity_id and profile_id=profile;
  if found and member.confirmed then continue; end if;
  if p_rate.id is null then raise exception 'An activity fee is required for new attendance' using errcode='22023'; end if;
  select concat_ws(' ',p.first_name,p.last_name) into player_name from public.profiles p where p.id=profile
   and p.club_id=p_club and p.approved and p.active and p.is_player;
  if not found then raise exception 'Player is outside the active club squad' using errcode='42501'; end if;
  entry_id:=null;
  if p_rate.amount_pence>0 then
   entry_id:=public.post_account_entry(jsonb_build_object('club_id',p_club,'profile_id',profile,'actor_id',p_actor,
    'kind','charge','amount_pence',-p_rate.amount_pence,'source',source_name,
    'source_id','attendance:'||p_request::text||':add:'||profile::text,'description',label,
    'category',p_category,'activity_type',p_activity_type,'activity_id',p_activity_id,'occurred_on',p_date,
    'activity_snapshot',p_snapshot||jsonb_build_object('fee_rate_id',p_rate.id,'fee_amount_pence',p_rate.amount_pence,
     'fee_effective_from',p_rate.effective_from)));
  end if;
  insert into public.activity_attendance_members(club_id,activity_type,activity_id,profile_id,player_name,confirmed,
   cycle,charge_entry_id,fee_amount_pence,fee_rate_id)
  values(p_club,p_activity_type,p_activity_id,profile,player_name,true,coalesce(member.cycle,0)+1,entry_id,p_rate.amount_pence,p_rate.id)
  on conflict(club_id,activity_type,activity_id,profile_id) do update set player_name=excluded.player_name,confirmed=true,
   cycle=excluded.cycle,charge_entry_id=excluded.charge_entry_id,fee_amount_pence=excluded.fee_amount_pence,fee_rate_id=excluded.fee_rate_id;
 end loop;
end; $$;

create function public.fixture_appearance_context(p_club uuid,p_fixture uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 f public.fixtures; team public.teams; opponent text; rate public.club_fee_rates;
 category text; playable boolean; snapshot jsonb; occurrence jsonb;
begin
 select * into f from public.fixtures where id=p_fixture and club_id=p_club;
 if not found then raise exception 'Match is outside this club' using errcode='42501'; end if;
 if not isfinite(f.match_date) then raise exception 'Match needs a valid date' using errcode='22023'; end if;
 select * into team from public.teams where id=f.team_id and club_id=p_club;
 if not found then raise exception 'Match team is outside this club' using errcode='42501'; end if;
 select name into opponent from public.opponents where id=f.opponent_id and club_id=p_club;
 category:=case when team.is_first_team then 'first_team' else 'community' end;
 select * into rate from public.club_fee_rate_on(p_club,category,f.match_date);
 playable:=f.status='scheduled' and exists(select 1 from public.results where fixture_id=f.id)
  and ((f.match_date+f.kickoff) at time zone 'Europe/London')<=now();
 snapshot:=jsonb_build_object('fixture_id',f.id,'team_id',team.id,'team',team.label,'category',category,
  'date',f.match_date,'kickoff',f.kickoff,'opponent_id',f.opponent_id,'opponent',opponent,'home_away',f.home_away);
 occurrence:=snapshot||jsonb_build_object('status',f.status,'has_result',exists(select 1 from public.results where fixture_id=f.id),
  'fee_rate_id',rate.id,'fee_amount_pence',rate.amount_pence);
 return jsonb_build_object('fixture_id',f.id,'occurrence_fingerprint',md5(occurrence::text),'can_confirm',playable,
  'unavailable_reason',case when f.status<>'scheduled' then 'Match postponed' when not playable then 'Match has not been played' else null end,
  'category',category,'activity_date',f.match_date,'snapshot',snapshot,
  'rate',case when rate.id is null then null else jsonb_build_object('id',rate.id,'amount_pence',rate.amount_pence,'effective_from',rate.effective_from) end);
end; $$;

create function public.get_fixture_appearance_register(p_fixture_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 club uuid:=public.payments_manager_club(false);
 context jsonb:=public.fixture_appearance_context(club,p_fixture_id);
 register public.activity_attendance_registers;
 ids uuid[]; players jsonb;
begin
 select * into register from public.activity_attendance_registers
  where club_id=club and activity_type='fixture' and activity_id=p_fixture_id;
 select coalesce(array_agg(profile_id order by profile_id),'{}'::uuid[]) into ids from public.activity_attendance_members
  where club_id=club and activity_type='fixture' and activity_id=p_fixture_id and confirmed;
 select coalesce(jsonb_agg(jsonb_build_object('profile_id',people.profile_id,'player_name',people.player_name,
  'eligible',people.eligible,'confirmed',coalesce(m.confirmed,false),'charge_entry_id',m.charge_entry_id,
  'waived',m.charge_entry_id is not null and exists(select 1 from public.account_entries r where r.linked_entry_id=m.charge_entry_id and r.kind='reversal'))
  order by people.player_name,people.profile_id),'[]'::jsonb) into players
 from (
  select p.id profile_id,concat_ws(' ',p.first_name,p.last_name) player_name,true eligible
   from public.profiles p where p.club_id=club and p.approved and p.active and p.is_player
  union all
  select m.profile_id,m.player_name,false from public.activity_attendance_members m
   where m.club_id=club and m.activity_type='fixture' and m.activity_id=p_fixture_id and m.confirmed
    and not exists(select 1 from public.profiles p where p.id=m.profile_id and p.club_id=club and p.approved and p.active and p.is_player)
 ) people left join public.activity_attendance_members m on m.club_id=club and m.activity_type='fixture'
  and m.activity_id=p_fixture_id and m.profile_id=people.profile_id;
 return (context-'snapshot')||jsonb_build_object('revision',coalesce(register.revision,0),'confirmed_profile_ids',ids,
  'allow_clear',cardinality(ids)>0,'players',players,'confirmed_at',register.confirmed_at);
end; $$;

create function public.confirm_fixture_appearances(p_request_id uuid,p_fixture_id uuid,p_expected_revision integer,
 p_occurrence_fingerprint text,p_profile_ids uuid[])
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 club uuid:=public.payments_manager_club(true); actor uuid:=auth.uid();
 profiles uuid[]; payload jsonb; prior public.activity_attendance_requests;
 register public.activity_attendance_registers; context jsonb; rate public.club_fee_rates;
 result jsonb; has_additions boolean; current_revision integer;
begin
 if p_request_id is null or p_fixture_id is null or p_expected_revision is null or p_expected_revision<0
  or p_occurrence_fingerprint is null or p_profile_ids is null or array_position(p_profile_ids,null) is not null
  or cardinality(p_profile_ids)<>(select count(distinct id) from unnest(p_profile_ids) id) then
  raise exception 'Submit a valid attendance selection and request reference' using errcode='22023';
 end if;
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into profiles from unnest(p_profile_ids) id;
 payload:=jsonb_build_object('fixture_id',p_fixture_id,'expected_revision',p_expected_revision,
  'occurrence_fingerprint',p_occurrence_fingerprint,'profile_ids',profiles);
 select * into prior from public.activity_attendance_requests where club_id=club and request_id=p_request_id;
 if found then
  if prior.actor_id is distinct from actor or prior.payload is distinct from payload then
   raise exception 'Attendance reference already used for a different confirmation' using errcode='22023';
  end if;
  return prior.result;
 end if;
 -- Existing fixture changes and fee/waiver operations cannot interleave with
 -- the financial difference. Lock the operational occurrence until commit too.
 perform 1 from public.fixtures where id=p_fixture_id and club_id=club for update;
 if not found then raise exception 'Match is outside this club' using errcode='42501'; end if;
 perform 1 from public.results where fixture_id=p_fixture_id for update;
 perform 1 from public.teams t join public.fixtures f on f.team_id=t.id where f.id=p_fixture_id for share of t;
 context:=public.fixture_appearance_context(club,p_fixture_id);
 select * into register from public.activity_attendance_registers where club_id=club and activity_type='fixture' and activity_id=p_fixture_id;
 current_revision:=coalesce(register.revision,0);
 if current_revision<>p_expected_revision or context->>'occurrence_fingerprint'<>p_occurrence_fingerprint then
  raise exception 'Match details or attendance changed. Refresh and try again' using errcode='40001';
 end if;
 if not (context->>'can_confirm')::boolean and not (register.revision is not null and cardinality(profiles)=0) then
  raise exception 'Only a played match can have confirmed appearances' using errcode='22023';
 end if;
 -- Former players may remain unchanged or be removed; only NEW appearances
 -- require an approved active player. No team-membership/line-up/reply proxy.
 if exists(select 1 from unnest(profiles) id where not exists(select 1 from public.activity_attendance_members m
  where m.club_id=club and m.activity_type='fixture' and m.activity_id=p_fixture_id and m.profile_id=id and m.confirmed)
  and not exists(select 1 from public.profiles p where p.id=id and p.club_id=club and p.approved and p.active and p.is_player)) then
  raise exception 'Player is outside the active club squad' using errcode='42501';
 end if;
 select exists(select 1 from unnest(profiles) id where not exists(select 1 from public.activity_attendance_members m
  where m.club_id=club and m.activity_type='fixture' and m.activity_id=p_fixture_id and m.profile_id=id and m.confirmed)) into has_additions;
 if has_additions then
  select * into rate from public.club_fee_rate_on(club,context->>'category',(context->>'activity_date')::date);
  if rate.id is null then
   raise exception 'Set the match fee for this fixture date before confirming new appearances' using errcode='22023';
  end if;
 end if;
 insert into public.activity_attendance_registers(club_id,activity_type,activity_id,occurrence_fingerprint)
  values(club,'fixture',p_fixture_id,p_occurrence_fingerprint) on conflict do nothing;
 perform public.apply_confirmed_activity_members(club,'fixture',p_fixture_id,profiles,context->>'category',
  (context->>'activity_date')::date,rate,context->'snapshot',actor,p_request_id);
 update public.activity_attendance_registers set revision=current_revision+1,occurrence_fingerprint=p_occurrence_fingerprint,
  confirmed_by=actor,confirmed_at=now() where club_id=club and activity_type='fixture' and activity_id=p_fixture_id;
 result:=public.get_fixture_appearance_register(p_fixture_id);
 insert into public.activity_attendance_requests(club_id,request_id,actor_id,payload,result) values(club,p_request_id,actor,payload,result);
 return result;
end; $$;
revoke all on function public.apply_confirmed_activity_members(uuid,text,uuid,uuid[],text,date,public.club_fee_rates,jsonb,uuid,uuid),
 public.fixture_appearance_context(uuid,uuid),public.get_fixture_appearance_register(uuid),
 public.confirm_fixture_appearances(uuid,uuid,integer,text,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_fixture_appearance_register(uuid),public.confirm_fixture_appearances(uuid,uuid,integer,text,uuid[]) to authenticated;
comment on function public.confirm_fixture_appearances(uuid,uuid,integer,text,uuid[]) is
 'Manager-confirmed actual appearances only. Club and fixture locks, occurrence hash plus attendance revision, immutable request replay. New appearances use the event-date fee; removals negate original entries once, including prior administrative waivers. Empty existing registers may close after postponement; no selection or availability triggers.';
commit;
