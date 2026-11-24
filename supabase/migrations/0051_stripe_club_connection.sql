begin;

-- Credentials and caches are never exposed through browser table grants.
-- A platform/sandbox change has its own reservation; test and live cannot share one.
create table public.club_stripe_connections (
 club_id uuid not null references public.clubs(id),
 platform_account_id text not null check(platform_account_id ~ '^acct_[A-Za-z0-9]+$'),
 livemode boolean not null,
 creation_id uuid not null default gen_random_uuid() unique,
 creation_started_at timestamptz not null default now(),
 stripe_account_id text check(stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
 charges_enabled boolean not null default false,
 payouts_enabled boolean not null default false,
 requirements jsonb not null default '{}' check(jsonb_typeof(requirements)='object'),
 capabilities jsonb not null default '{}' check(jsonb_typeof(capabilities)='object'),
 checked_at timestamptz,
 primary key(club_id,platform_account_id,livemode),
 unique(platform_account_id,livemode,stripe_account_id)
);
alter table public.club_stripe_connections enable row level security;
revoke all on public.club_stripe_connections from public,anon,authenticated,service_role;
grant select on public.club_stripe_connections to service_role;

create function public.reserve_club_stripe_connection(p_club_id uuid,p_platform_account_id text,p_livemode boolean,p_actor_id uuid)
returns public.club_stripe_connections language plpgsql security definer set search_path=pg_catalog,public as $$
declare result public.club_stripe_connections;
begin
 if not exists(select 1 from public.profiles where id=p_actor_id and club_id=p_club_id and role='admin' and approved and active)
  or not coalesce((select enabled from public.club_payments_release where club_id=p_club_id),false) then
  raise exception 'Club payments access refused' using errcode='42501';
 end if;
 insert into public.club_stripe_connections(club_id,platform_account_id,livemode)
 values(p_club_id,p_platform_account_id,p_livemode) on conflict(club_id,platform_account_id,livemode) do nothing;
 select * into strict result from public.club_stripe_connections
 where club_id=p_club_id and platform_account_id=p_platform_account_id and livemode=p_livemode;
 return result;
end; $$;

-- Bind once, including after an ambiguous Stripe response, then only refresh status.
create function public.save_club_stripe_connection(p_club_id uuid,p_platform_account_id text,p_livemode boolean,
 p_creation_id uuid,p_account_id text,p_status jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare connection public.club_stripe_connections;
begin
 select * into strict connection from public.club_stripe_connections
 where club_id=p_club_id and platform_account_id=p_platform_account_id and livemode=p_livemode for update;
 if connection.creation_id is distinct from p_creation_id
  or (connection.stripe_account_id is not null and connection.stripe_account_id is distinct from p_account_id)
  or p_account_id is null or p_account_id=p_platform_account_id then
  raise exception 'Stripe account scope mismatch' using errcode='22023';
 end if;
 update public.club_stripe_connections set stripe_account_id=p_account_id,
  charges_enabled=coalesce((p_status->>'charges_enabled')::boolean,false),
  payouts_enabled=coalesce((p_status->>'payouts_enabled')::boolean,false),
  requirements=coalesce(p_status->'requirements','{}'),capabilities=coalesce(p_status->'capabilities','{}'),checked_at=now()
 where club_id=p_club_id and platform_account_id=p_platform_account_id and livemode=p_livemode;
end; $$;

revoke all on function public.reserve_club_stripe_connection(uuid,text,boolean,uuid),
 public.save_club_stripe_connection(uuid,text,boolean,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.reserve_club_stripe_connection(uuid,text,boolean,uuid),
 public.save_club_stripe_connection(uuid,text,boolean,uuid,text,jsonb) to service_role;
comment on table public.club_stripe_connections is 'Internal per-club, platform and mode Stripe account binding. Creation identity survives retries and must never be reset to recover an ambiguous provider response. Readiness caches are informational; Edge status reads Stripe freshly.';
commit;
