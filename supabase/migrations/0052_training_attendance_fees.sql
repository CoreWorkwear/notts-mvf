begin;

-- Training occurrences use the shared attendance projection/difference engine,
-- never advance replies or the whole recurring series as a financial source.
create function public.training_attendance_context(p_club uuid,p_session uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 session public.training_sessions;
 rate public.club_fee_rates;
 started boolean;
 snapshot jsonb;
begin
 select * into session from public.training_sessions where id=p_session and club_id=p_club;
 if not found then raise exception 'Training is outside this club' using errcode='42501'; end if;
 if not isfinite(session.start_date) or session.start_time>=time '24:00' then
  raise exception 'Training needs a valid date and start time' using errcode='22023';
 end if;
 select * into rate from public.club_fee_rate_on(p_club,'training',session.start_date);
 started:=((session.start_date+session.start_time) at time zone 'Europe/London')<=now();
 snapshot:=jsonb_build_object('session_id',session.id,'series_id',session.series_id,'date',session.start_date,
  'start_time',session.start_time,'venue',session.venue,'town',session.town,'audience',session.audience,
  'focus',session.focus,'occurrence_revision',session.revision);
 return jsonb_build_object('session_id',session.id,'occurrence_revision',session.revision,
  'occurrence_fingerprint',md5((to_jsonb(session)||jsonb_build_object('fee_rate_id',rate.id,'fee_amount_pence',rate.amount_pence))::text),
  'can_confirm',started and not session.cancelled,
  'unavailable_reason',case when session.cancelled then 'Training cancelled' when not started then 'Training has not started' else null end,
  'category','training','activity_date',session.start_date,'snapshot',snapshot,
  'rate',case when rate.id is null then null else jsonb_build_object('id',rate.id,'amount_pence',rate.amount_pence,'effective_from',rate.effective_from) end);
end; $$;

create function public.get_training_attendance_register(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 club uuid:=public.payments_manager_club(false);
 context jsonb:=public.training_attendance_context(club,p_session_id);
 register public.activity_attendance_registers;
 ids uuid[];
 players jsonb;
begin
 select * into register from public.activity_attendance_registers
  where club_id=club and activity_type='training_session' and activity_id=p_session_id;
 select coalesce(array_agg(profile_id order by profile_id),'{}'::uuid[]) into ids from public.activity_attendance_members
  where club_id=club and activity_type='training_session' and activity_id=p_session_id and confirmed;
 select coalesce(jsonb_agg(jsonb_build_object('profile_id',people.profile_id,'player_name',people.player_name,
  'eligible',people.eligible,'confirmed',coalesce(m.confirmed,false),'charge_entry_id',m.charge_entry_id,
  'waived',m.charge_entry_id is not null and exists(select 1 from public.account_entries r where r.linked_entry_id=m.charge_entry_id and r.kind='reversal'))
  order by people.player_name,people.profile_id),'[]'::jsonb) into players
 from (
  select p.id profile_id,concat_ws(' ',p.first_name,p.last_name) player_name,true eligible
   from public.profiles p where p.club_id=club and p.approved and p.active and p.is_player
  union all
  select m.profile_id,m.player_name,false from public.activity_attendance_members m
   where m.club_id=club and m.activity_type='training_session' and m.activity_id=p_session_id and m.confirmed
    and not exists(select 1 from public.profiles p where p.id=m.profile_id and p.club_id=club and p.approved and p.active and p.is_player)
 ) people left join public.activity_attendance_members m on m.club_id=club and m.activity_type='training_session'
  and m.activity_id=p_session_id and m.profile_id=people.profile_id;
 return (context-'snapshot')||jsonb_build_object('revision',coalesce(register.revision,0),'confirmed_profile_ids',ids,
  'allow_clear',cardinality(ids)>0,'players',players,'confirmed_at',register.confirmed_at);
end; $$;

create function public.confirm_training_attendance(p_request_id uuid,p_session_id uuid,p_expected_revision integer,
 p_occurrence_fingerprint text,p_profile_ids uuid[])
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 club uuid:=public.payments_manager_club(true);
 actor uuid:=auth.uid();
 profiles uuid[];
 payload jsonb;
 prior public.activity_attendance_requests;
 register public.activity_attendance_registers;
 context jsonb;
 rate public.club_fee_rates;
 result jsonb;
 has_additions boolean;
 current_revision integer;
begin
 if p_request_id is null or p_session_id is null or p_expected_revision is null or p_expected_revision<0
  or p_occurrence_fingerprint is null or p_profile_ids is null or array_position(p_profile_ids,null) is not null
  or cardinality(p_profile_ids)<>(select count(distinct id) from unnest(p_profile_ids) id) then
  raise exception 'Submit a valid attendance selection and request reference' using errcode='22023';
 end if;
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into profiles from unnest(p_profile_ids) id;
 payload:=jsonb_build_object('session_id',p_session_id,'expected_revision',p_expected_revision,
  'occurrence_fingerprint',p_occurrence_fingerprint,'profile_ids',profiles);
 select * into prior from public.activity_attendance_requests where club_id=club and request_id=p_request_id;
 if found then
  if prior.actor_id is distinct from actor or prior.payload is distinct from payload then
   raise exception 'Attendance reference already used for a different confirmation' using errcode='22023';
  end if;
  return prior.result;
 end if;
 -- Session edit/cancel RPCs lock this same row. The post reads its locked,
 -- current revision and cancellation state before calculating any difference.
 perform 1 from public.training_sessions where id=p_session_id and club_id=club for update;
 if not found then raise exception 'Training is outside this club' using errcode='42501'; end if;
 context:=public.training_attendance_context(club,p_session_id);
 select * into register from public.activity_attendance_registers
  where club_id=club and activity_type='training_session' and activity_id=p_session_id;
 current_revision:=coalesce(register.revision,0);
 if current_revision<>p_expected_revision or context->>'occurrence_fingerprint'<>p_occurrence_fingerprint then
  raise exception 'Training details or attendance changed. Refresh and try again' using errcode='40001';
 end if;
 if not (context->>'can_confirm')::boolean and not(register.revision is not null and cardinality(profiles)=0) then
  raise exception 'Only started, uncancelled training can have confirmed attendance' using errcode='22023';
 end if;
 if exists(select 1 from unnest(profiles) id where not exists(select 1 from public.activity_attendance_members m
  where m.club_id=club and m.activity_type='training_session' and m.activity_id=p_session_id and m.profile_id=id and m.confirmed)
  and not exists(select 1 from public.profiles p where p.id=id and p.club_id=club and p.approved and p.active and p.is_player)) then
  raise exception 'Player is outside the active club squad' using errcode='42501';
 end if;
 select exists(select 1 from unnest(profiles) id where not exists(select 1 from public.activity_attendance_members m
  where m.club_id=club and m.activity_type='training_session' and m.activity_id=p_session_id and m.profile_id=id and m.confirmed)) into has_additions;
 if has_additions then
  select * into rate from public.club_fee_rate_on(club,'training',(context->>'activity_date')::date);
  if rate.id is null then
   raise exception 'Set the training fee for this session date before confirming new attendance' using errcode='22023';
  end if;
 end if;
 insert into public.activity_attendance_registers(club_id,activity_type,activity_id,occurrence_fingerprint)
  values(club,'training_session',p_session_id,p_occurrence_fingerprint) on conflict do nothing;
 perform public.apply_confirmed_activity_members(club,'training_session',p_session_id,profiles,'training',
  (context->>'activity_date')::date,rate,context->'snapshot',actor,p_request_id);
 update public.activity_attendance_registers set revision=current_revision+1,occurrence_fingerprint=p_occurrence_fingerprint,
  confirmed_by=actor,confirmed_at=now() where club_id=club and activity_type='training_session' and activity_id=p_session_id;
 result:=public.get_training_attendance_register(p_session_id);
 insert into public.activity_attendance_requests(club_id,request_id,actor_id,payload,result)
  values(club,p_request_id,actor,payload,result);
 return result;
end; $$;

revoke all on function public.training_attendance_context(uuid,uuid),public.get_training_attendance_register(uuid),
 public.confirm_training_attendance(uuid,uuid,integer,text,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_training_attendance_register(uuid),public.confirm_training_attendance(uuid,uuid,integer,text,uuid[]) to authenticated;
comment on function public.confirm_training_attendance(uuid,uuid,integer,text,uuid[]) is
 'Manager-confirmed actual training attendance per occurrence. Locks current session with attendance revision and full occurrence/rate hash. Replies never post fees. New attendance uses the London session-date club rate; original fee reversals, waivers, zero rates and exact request replay use the shared engine. A fresh empty confirmation may close an existing cancelled register without new charges.';
commit;
