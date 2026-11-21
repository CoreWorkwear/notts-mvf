-- Training is additive and independent of seasons/fixtures. Apply before the
-- Training client. Existing clients remain compatible. No data is reset.
-- Rollback: disable the Training client first; retain these tables for history.
begin;

create table public.training_sessions (
 id uuid primary key default gen_random_uuid(),
 club_id uuid not null references public.clubs(id) on delete cascade,
 start_date date not null,
 start_time time not null,
 venue text not null check (length(btrim(venue)) between 1 and 160),
 town text not null default '' check (length(town)<=120),
 audience text not null check (audience in ('xl','community','club')),
 focus text check (length(focus)<=1000),
 cancelled boolean not null default false,
 revision integer not null default 1 check (revision>0),
 series_id uuid,
 created_at timestamptz not null default now()
);
create index training_sessions_club_date_idx on public.training_sessions(club_id,start_date,start_time,id);
create index training_sessions_series_idx on public.training_sessions(series_id) where series_id is not null;

create table public.training_replies (
 session_id uuid not null references public.training_sessions(id) on delete cascade,
 profile_id uuid not null references public.profiles(id) on delete cascade,
 status text not null check (status in ('in','maybe','out')),
 updated_at timestamptz not null default now(),
 primary key(session_id,profile_id)
);
create index training_replies_profile_idx on public.training_replies(profile_id);

-- Private request receipts make retries return the original outcome even if
-- another player replied or another manager edited the occurrence afterwards.
create table public.training_requests (
 actor_id uuid not null references public.profiles(id) on delete cascade,
 request_id uuid not null,
 operation text not null,
 payload jsonb not null,
 session_id uuid not null references public.training_sessions(id) on delete cascade,
 result_revision integer not null,
 created_at timestamptz not null default now(),
 primary key(actor_id,request_id)
);

alter table public.training_sessions enable row level security;
alter table public.training_replies enable row level security;
alter table public.training_requests enable row level security;
revoke all on public.training_sessions,public.training_replies,public.training_requests from public,anon,authenticated;
grant select on public.training_sessions,public.training_replies to authenticated;
grant all on public.training_sessions,public.training_replies,public.training_requests to service_role;

-- Internal predicate, called by owner-run functions only. Membership is
-- checked against the invited squad; dual-squad players still yield one row.
create function public.training_player_eligible(p_session_id uuid,p_profile_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists (
  select 1 from training_sessions s join profiles p on p.id=p_profile_id
  where s.id=p_session_id and p.club_id=s.club_id and p.approved and p.active and p.is_player
   and (s.audience='club' or exists (
    select 1 from team_memberships m join teams t on t.id=m.team_id
    where m.profile_id=p.id and t.club_id=s.club_id and t.key=s.audience))
 );
$$;
revoke all on function public.training_player_eligible(uuid,uuid) from public,anon,authenticated;

create function public.training_can_view(p_session_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists (
  select 1 from training_sessions s join profiles p on p.id=auth.uid()
  where s.id=p_session_id and s.club_id=p.club_id
   and (is_admin(p.id) or (p.approved and p.active and
     (s.audience='club' or training_player_eligible(s.id,p.id))))
 );
$$;
revoke all on function public.training_can_view(uuid) from public,anon;
grant execute on function public.training_can_view(uuid) to authenticated,service_role;
create policy training_sessions_select on public.training_sessions for select to authenticated
 using (training_can_view(id));
create policy training_replies_select on public.training_replies for select to authenticated
 using ((profile_id=(select auth.uid()) and training_can_view(session_id))
  or ((select is_admin(auth.uid())) and exists(
   select 1 from public.training_sessions s where s.id=session_id and s.club_id=(select current_club_id()))));

create function public.create_training_sessions(
 p_request_id uuid,p_date date,p_time time,p_venue text,p_town text,p_audience text,
 p_focus text default null,p_repeat_weeks integer default 0,p_until date default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare
 v_actor uuid:=auth.uid(); v_club uuid:=current_club_id(); v_payload jsonb;
 v_request training_requests%rowtype; v_first uuid; v_id uuid; v_series uuid;
 v_date date; v_count integer;
begin
 if v_actor is null or not is_admin(v_actor) then raise exception 'Only a manager can publish training' using errcode='42501'; end if;
 if p_request_id is null then raise exception 'A request id is required' using errcode='22023'; end if;
 v_payload:=jsonb_build_array(p_date,p_time,p_venue,p_town,p_audience,p_focus,p_repeat_weeks,p_until);
 perform pg_advisory_xact_lock(hashtextextended(v_actor::text||p_request_id::text,0));
 select * into v_request from training_requests where actor_id=v_actor and request_id=p_request_id;
 if found then
  if v_request.operation<>'create' or v_request.payload<>v_payload then raise exception 'Request id was used for a different change' using errcode='22023'; end if;
  return v_request.session_id;
 end if;
 if p_date is null or p_time is null or ((p_date+p_time) at time zone 'Europe/London')<=now() then
  raise exception 'Choose a future training date and time' using errcode='22023'; end if;
 if p_audience is null or p_audience not in ('xl','community','club') or p_venue is null
  or length(btrim(p_venue)) not between 1 and 160 or length(coalesce(p_town,''))>120 or length(p_focus)>1000 then
  raise exception 'Check the training details' using errcode='22023'; end if;
 if p_repeat_weeks is null or p_repeat_weeks not between 0 and 52 then raise exception 'Repeat every 1 to 52 weeks, or choose one session' using errcode='22023'; end if;
 if p_repeat_weeks=0 then v_count:=1;
 else
  if p_until is null or p_until<p_date then raise exception 'Choose an end date on or after the first session' using errcode='22023'; end if;
  v_count:=((p_until-p_date)/(7*p_repeat_weeks))+1;
 end if;
 if v_count>500 then raise exception 'A series can contain at most 500 sessions' using errcode='22023'; end if;
 if p_repeat_weeks>0 then v_series:=gen_random_uuid(); end if;
 for n in 0..v_count-1 loop
  v_date:=p_date+n*7*p_repeat_weeks;
  insert into training_sessions(club_id,start_date,start_time,venue,town,audience,focus,series_id)
   values(v_club,v_date,p_time,btrim(p_venue),btrim(coalesce(p_town,'')),p_audience,nullif(btrim(p_focus),''),v_series) returning id into v_id;
  if n=0 then v_first:=v_id; end if;
 end loop;
 insert into training_requests(actor_id,request_id,operation,payload,session_id,result_revision)
 values(v_actor,p_request_id,'create',v_payload,v_first,1);
 return v_first;
end;
$$;
revoke all on function public.create_training_sessions(uuid,date,time,text,text,text,text,integer,date) from public,anon;
grant execute on function public.create_training_sessions(uuid,date,time,text,text,text,text,integer,date) to authenticated,service_role;

create function public.reply_to_training(p_session_id uuid,p_revision integer,p_status text)
returns void language plpgsql security definer set search_path=public as $$
declare v_session training_sessions%rowtype; v_actor uuid:=auth.uid();
begin
 select * into v_session from training_sessions where id=p_session_id for update;
 if not found or not training_player_eligible(p_session_id,v_actor) then raise exception 'You cannot reply to this training session' using errcode='42501'; end if;
 if p_revision is distinct from v_session.revision then raise exception 'Training has changed. Refresh the session before replying' using errcode='40001'; end if;
 if v_session.cancelled or ((v_session.start_date+v_session.start_time) at time zone 'Europe/London')<=now() then
  raise exception 'This training session is closed for replies' using errcode='22023'; end if;
 if p_status is null or p_status not in ('in','maybe','out') then raise exception 'Choose In, Maybe or Out' using errcode='22023'; end if;
 insert into training_replies(session_id,profile_id,status) values(p_session_id,v_actor,p_status)
 on conflict(session_id,profile_id) do update set status=excluded.status,updated_at=now();
end;
$$;
revoke all on function public.reply_to_training(uuid,integer,text) from public,anon;
grant execute on function public.reply_to_training(uuid,integer,text) to authenticated,service_role;

create function public.training_headcount(p_session_id uuid)
returns table(profile_id uuid,first_name text,last_name text,status text)
language plpgsql stable security definer set search_path=public as $$
begin
 if not is_admin(auth.uid()) or not exists(select 1 from training_sessions s where s.id=p_session_id and s.club_id=current_club_id()) then
  raise exception 'Only a club manager can view the training headcount' using errcode='42501'; end if;
 return query select p.id,p.first_name,p.last_name,r.status from profiles p
 left join training_replies r on r.session_id=p_session_id and r.profile_id=p.id
 where training_player_eligible(p_session_id,p.id)
 order by p.first_name,p.last_name,p.id;
end;
$$;
revoke all on function public.training_headcount(uuid) from public,anon;
grant execute on function public.training_headcount(uuid) to authenticated,service_role;

comment on table public.training_sessions is 'London wall-clock training occurrences. Read with date/keyset pagination; no season dependency. Mutations are RPC-only.';
comment on table public.training_requests is 'Private immutable idempotency receipts. Keep for the life of the session so delayed retries cannot repeat a change.';
commit;
