-- One durable club event per occurrence change; push dispatch is a separately
-- leased outbox, never a remote call inside a training transaction.
begin;
create table public.training_notices (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references public.training_sessions(id) on delete cascade,
 club_id uuid not null references public.clubs(id) on delete cascade,
 kind text not null check(kind in ('moved','cancelled')),
 title text not null,
 body text not null,
 created_at timestamptz not null default now()
);
create index training_notices_club_created_idx on public.training_notices(club_id,created_at desc,id);
alter table public.training_notices enable row level security;
revoke all on public.training_notices from public,anon,authenticated;
grant select on public.training_notices to authenticated;
grant all on public.training_notices to service_role;
-- Includes all signed-off club app accounts, including non-invitees and supporters.
-- current_club_id keeps pending/inactive accounts on the existing Holding gate.
create policy training_notices_select on public.training_notices for select to authenticated
 using (club_id=(select current_club_id()));

create table public.training_push_outbox (
 id uuid primary key default gen_random_uuid(),
 notice_id uuid not null references public.training_notices(id) on delete cascade,
 profile_id uuid not null references public.profiles(id) on delete cascade,
 push_token_id uuid not null,
 device_token jsonb not null,
 title text not null,body text not null,tag text not null,url text not null,
 can_reply boolean not null,
 state text not null default 'pending' check(state in ('pending','leased','sent','dead')),
 attempts integer not null default 0,
 available_at timestamptz not null default now(),
 lease_token uuid,locked_until timestamptz,sent_at timestamptz,last_error text,
 unique(notice_id,push_token_id)
);
create index training_push_ready_idx on public.training_push_outbox(available_at,id) where state in ('pending','leased');
alter table public.training_push_outbox enable row level security;
revoke all on public.training_push_outbox from public,anon,authenticated;
grant all on public.training_push_outbox to service_role;

-- Corrupt legacy subscriptions must not roll back the club's session edit.
create function public.training_subscription(p_token text) returns jsonb
language plpgsql immutable set search_path=public as $$
declare v jsonb;
begin
 v:=p_token::jsonb;
 if jsonb_typeof(v)<>'object' or coalesce(v->>'endpoint','')='' or v->'keys' is null then return null; end if;
 return v;
exception when invalid_text_representation then return null;
end;
$$;
revoke all on function public.training_subscription(text) from public,anon,authenticated;

create function public.change_training_session(
 p_session_id uuid,p_revision integer,p_request_id uuid,p_date date,p_time time,
 p_venue text,p_town text,p_focus text,p_cancel boolean default false)
returns integer language plpgsql security definer set search_path=public as $$
declare
 v_actor uuid:=auth.uid(); v_club uuid:=current_club_id(); v_payload jsonb;
 v_request training_requests%rowtype; v_old training_sessions%rowtype; v_new training_sessions%rowtype;
 v_notice uuid; v_body text; v_title text; v_kind text; v_moved boolean;
 v_old_when text; v_new_when text;
begin
 if v_actor is null or not is_admin(v_actor) then raise exception 'Only a manager can change training' using errcode='42501'; end if;
 if p_request_id is null then raise exception 'A request id is required' using errcode='22023'; end if;
 v_payload:=jsonb_build_array(p_session_id,p_revision,p_date,p_time,p_venue,p_town,p_focus,p_cancel);
 perform pg_advisory_xact_lock(hashtextextended(v_actor::text||p_request_id::text,0));
 select * into v_request from training_requests where actor_id=v_actor and request_id=p_request_id;
 if found then
  if v_request.operation<>'change' or v_request.payload<>v_payload then raise exception 'Request id was used for a different change' using errcode='22023'; end if;
  return v_request.result_revision;
 end if;
 select * into v_old from training_sessions where id=p_session_id for update;
 if not found or v_old.club_id is distinct from v_club then raise exception 'You cannot change this training session' using errcode='42501'; end if;
 if p_revision is distinct from v_old.revision then raise exception 'Training has changed. Refresh before saving' using errcode='40001'; end if;
 if v_old.cancelled then raise exception 'This training session is already cancelled' using errcode='22023'; end if;
 if p_cancel is null or p_date is null or p_time is null or p_venue is null
  or length(btrim(p_venue)) not between 1 and 160 or length(coalesce(p_town,''))>120 or length(p_focus)>1000 then
  raise exception 'Check the training details' using errcode='22023'; end if;
 if not p_cancel and ((p_date+p_time) at time zone 'Europe/London')<=now() then
  raise exception 'Choose a future training date and time' using errcode='22023'; end if;
 v_moved:=row(v_old.start_date,v_old.start_time,v_old.venue,v_old.town)
  is distinct from row(p_date,p_time,btrim(p_venue),btrim(coalesce(p_town,'')));
 if not v_moved and not p_cancel and v_old.focus is not distinct from nullif(btrim(p_focus),'') then
  insert into training_requests(actor_id,request_id,operation,payload,session_id,result_revision)
   values(v_actor,p_request_id,'change',v_payload,p_session_id,v_old.revision);
  return v_old.revision;
 end if;
 update training_sessions set start_date=p_date,start_time=p_time,venue=btrim(p_venue),town=btrim(coalesce(p_town,'')),
  focus=nullif(btrim(p_focus),''),cancelled=p_cancel,revision=revision+1
  where id=p_session_id returning * into v_new;
 -- Replies are not written or deleted here, including when cancelling.
 if p_cancel or v_moved then
  v_old_when:=to_char(v_old.start_date,'Dy DD Mon YYYY')||' at '||to_char(v_old.start_time,'HH24:MI');
  v_new_when:=to_char(v_new.start_date,'Dy DD Mon YYYY')||' at '||to_char(v_new.start_time,'HH24:MI');
  if p_cancel then
   v_kind:='cancelled'; v_title:='Training cancelled';
   v_body:='Training cancelled. '||v_new_when||', '||v_new.venue||case when v_new.town<>'' then ', '||v_new.town else '' end||'.';
  else
   v_kind:='moved'; v_title:='Training moved';
   v_body:='Training on '||v_old_when||', '||v_old.venue||case when v_old.town<>'' then ', '||v_old.town else '' end||
    ' has moved to '||v_new_when||', '||v_new.venue||case when v_new.town<>'' then ', '||v_new.town else '' end||'.';
  end if;
  insert into training_notices(session_id,club_id,kind,title,body) values(p_session_id,v_club,v_kind,v_title,v_body) returning id into v_notice;
  insert into training_push_outbox(notice_id,profile_id,push_token_id,device_token,title,body,tag,url,can_reply)
  select v_notice,p.id,t.id,public.training_subscription(t.token),v_title,
   v_body||case when not p_cancel and training_player_eligible(p_session_id,p.id) then ' Update your availability.' else '' end,
   'training-'||v_notice::text,
   '/training?session='||p_session_id::text,
   not p_cancel and training_player_eligible(p_session_id,p.id)
  from profiles p join push_tokens t on t.profile_id=p.id
  where p.club_id=v_club and p.active and (p.approved or p.role='admin') and public.training_subscription(t.token) is not null;
 end if;
 insert into training_requests(actor_id,request_id,operation,payload,session_id,result_revision)
  values(v_actor,p_request_id,'change',v_payload,p_session_id,v_new.revision);
 return v_new.revision;
end;
$$;
revoke all on function public.change_training_session(uuid,integer,uuid,date,time,text,text,text,boolean) from public,anon;
grant execute on function public.change_training_session(uuid,integer,uuid,date,time,text,text,text,boolean) to authenticated,service_role;

create function public.training_push_claim(p_limit integer default 50)
returns table(id uuid,lease_token uuid,device_token jsonb,title text,body text,tag text,url text,can_reply boolean)
language plpgsql security definer set search_path=public as $$
begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Claim between 1 and 100 notifications' using errcode='22023'; end if;
 -- Honour device opt-out after an event was queued. No new devices are added
 -- retrospectively; in-app delivery never depends on subscription state.
 update training_push_outbox o set state='dead',last_error='Device alerts disabled',lease_token=null,locked_until=null
 where o.state in ('pending','leased') and not exists(select 1 from push_tokens t where t.id=o.push_token_id and t.profile_id=o.profile_id and training_subscription(t.token)=o.device_token and exists(select 1 from profiles p where p.id=t.profile_id and p.club_id=(select n.club_id from training_notices n where n.id=o.notice_id) and p.active and (p.approved or p.role='admin')));
 update training_push_outbox o set state='dead',last_error='Delivery lease expired after five attempts',lease_token=null,locked_until=null
 where o.state='leased' and o.locked_until<now() and o.attempts>=5;
 return query
 with ready as (
  select o.id from training_push_outbox o
  where (o.state='pending' or (o.state='leased' and o.locked_until<now()))
   and o.available_at<=now() and o.attempts<5
  order by o.available_at,o.id for update skip locked limit p_limit
 ), claimed as (
  update training_push_outbox o set state='leased',lease_token=gen_random_uuid(),locked_until=now()+interval '2 minutes',attempts=o.attempts+1
  from ready where o.id=ready.id returning o.*
 ) select c.id,c.lease_token,c.device_token,c.title,c.body,c.tag,c.url,c.can_reply from claimed c;
end;
$$;
revoke all on function public.training_push_claim(integer) from public,anon,authenticated;
grant execute on function public.training_push_claim(integer) to service_role;

create function public.training_push_finish(p_id uuid,p_lease uuid,p_success boolean,p_error text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_changed integer;
begin
 if p_success is null then raise exception 'A delivery outcome is required' using errcode='22023'; end if;
 update training_push_outbox o set
  state=case when p_success then 'sent' when o.attempts>=5 or p_error in ('invalid_subscription','subscription_gone') then 'dead' else 'pending' end,
  sent_at=case when p_success then now() else null end,
  available_at=case when p_success then o.available_at else now()+make_interval(secs=>least(3600,30*(2^o.attempts)::integer)) end,
  lease_token=null,locked_until=null,last_error=case when p_success then null else left(coalesce(p_error,'Delivery failed'),500) end
 where o.id=p_id and o.state='leased' and o.lease_token=p_lease and o.locked_until>=now();
 get diagnostics v_changed=row_count;
 return v_changed=1;
end;
$$;
revoke all on function public.training_push_finish(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.training_push_finish(uuid,uuid,boolean,text) to service_role;
comment on table public.training_notices is 'One shared event visible to every same-club app account, regardless of invite/reply; current_club_id enforces sign-off and activity. Paginate by created_at,id. No private training focus or player list.';
comment on table public.training_push_outbox is 'Explicit device opt-in only. Unique notice/device; bounded claims with leases. External push is at-least-once: provider receipt and device receipt remain separate evidence; tag collapses redelivery.';
commit;





