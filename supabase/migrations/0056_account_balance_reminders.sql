begin;

create table public.account_reminder_batches (
  club_id uuid not null references public.clubs(id),
  id uuid not null,
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  push_claim_id uuid,
  push_claimed_at timestamptz,
  push_sent integer,
  push_failed integer,
  primary key (club_id,id)
);
create table public.account_reminder_notices (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  batch_id uuid not null,
  profile_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (club_id,batch_id) references public.account_reminder_batches(club_id,id),
  unique (club_id,batch_id,profile_id)
);
create index account_reminder_notices_recent on public.account_reminder_notices (club_id,profile_id,created_at desc,id desc);
alter table public.account_reminder_batches enable row level security;
alter table public.account_reminder_notices enable row level security;
revoke all on public.account_reminder_batches,public.account_reminder_notices from public,anon,authenticated,service_role;

create function public.account_reminder_targets(p_club_id uuid)
returns table(profile_id uuid, first_name text, balance_pence bigint)
language sql stable security definer set search_path=pg_catalog,public as $$
  select p.id,p.first_name,sum(e.amount_pence::bigint)
  from public.player_accounts a
  join public.profiles p on p.id=a.profile_id and p.club_id=a.club_id
  join public.account_entries e on e.account_id=a.id and e.club_id=a.club_id
  where a.club_id=p_club_id and p.approved and p.active and p.is_player
  group by p.id,p.first_name
  having sum(e.amount_pence::bigint)<0;
$$;

create function public.get_account_reminder_targets()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare club uuid := public.payments_manager_club(false);
begin
  return (select coalesce(jsonb_agg(to_jsonb(t) order by t.first_name,t.profile_id),'[]'::jsonb)
    from public.account_reminder_targets(club) t);
end;
$$;

create function public.get_my_account_reminder()
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object('id',n.id,'created_at',n.created_at)
  from public.account_reminder_notices n
  join public.profiles p on p.id=n.profile_id and p.club_id=n.club_id
  join public.club_payments_release r on r.club_id=n.club_id and r.enabled
  where n.profile_id=auth.uid() and p.approved and p.active and p.is_player
  order by n.created_at desc,n.id desc limit 1;
$$;

create function public.create_account_reminder_batch(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  club uuid := public.payments_manager_club(true);
  actor uuid := auth.uid();
  batch public.account_reminder_batches;
  targets integer;
begin
  if p_request_id is null then raise exception 'Reminder request required' using errcode='22023'; end if;
  select * into batch from public.account_reminder_batches where club_id=club and id=p_request_id;
  if found and batch.actor_id <> actor then raise exception 'Reminder request belongs to another manager' using errcode='42501'; end if;
  if not found then
    insert into public.account_reminder_batches(club_id,id,actor_id) values(club,p_request_id,actor) returning * into batch;
    insert into public.account_reminder_notices(club_id,batch_id,profile_id)
      select club,p_request_id,t.profile_id from public.account_reminder_targets(club) t;
  end if;
  select count(*) into targets from public.account_reminder_notices where club_id=club and batch_id=p_request_id;
  return jsonb_build_object('club_id',club,'request_id',p_request_id,'targeted',targets,
    'push_sent',batch.push_sent,'push_status',case when targets=0 then 'none'
      when batch.push_sent is not null then case when batch.push_failed > 0 then 'partial' else 'sent' end
      else 'pending' end);
end;
$$;

create function public.claim_account_reminder_push(p_club_id uuid,p_request_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare lease uuid := gen_random_uuid();
begin
  update public.account_reminder_batches b set push_claim_id=lease,push_claimed_at=now()
    where b.club_id=p_club_id and b.id=p_request_id and b.actor_id=p_actor_id and b.push_sent is null
      and (b.push_claimed_at is null or b.push_claimed_at < now()-interval '5 minutes')
      and exists(select 1 from public.profiles p where p.id=b.actor_id and p.club_id=b.club_id
        and p.role='admin' and p.active and p.approved)
      and exists(select 1 from public.club_payments_release r where r.club_id=b.club_id and r.enabled);
  if not found then return null; end if;
  return jsonb_build_object('claim_id',lease,'tokens',
    (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'token',t.token)),'[]')
     from public.account_reminder_notices n join public.push_tokens t on t.profile_id=n.profile_id
     join public.profiles p on p.id=n.profile_id and p.club_id=n.club_id and p.active and p.approved and p.is_player
     where n.club_id=p_club_id and n.batch_id=p_request_id));
end;
$$;

create function public.finish_account_reminder_push(p_club_id uuid,p_request_id uuid,p_claim_id uuid,p_sent integer,p_failed integer)
returns void language sql security definer set search_path=pg_catalog,public as $$
  update public.account_reminder_batches set push_sent=p_sent,push_failed=p_failed,push_claim_id=null
  where club_id=p_club_id and id=p_request_id and push_claim_id=p_claim_id and push_sent is null;
$$;

revoke all on function public.account_reminder_targets(uuid),public.get_account_reminder_targets(),
  public.get_my_account_reminder(),public.create_account_reminder_batch(uuid),
  public.claim_account_reminder_push(uuid,uuid,uuid),public.finish_account_reminder_push(uuid,uuid,uuid,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.get_account_reminder_targets(),public.get_my_account_reminder(),
  public.create_account_reminder_batch(uuid) to authenticated;
grant execute on function public.claim_account_reminder_push(uuid,uuid,uuid),
  public.finish_account_reminder_push(uuid,uuid,uuid,integer,integer) to service_role;
commit;
