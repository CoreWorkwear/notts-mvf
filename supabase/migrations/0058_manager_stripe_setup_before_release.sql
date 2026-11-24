begin;

-- Managers may prepare Stripe before the separate player-payments release.
-- This service-only RPC establishes setup identity; it never enables accounts
-- or changes any player write/read gate. Existing reservations remain stable.
create or replace function public.reserve_club_stripe_connection(p_club_id uuid,p_platform_account_id text,p_livemode boolean,p_actor_id uuid)
returns public.club_stripe_connections language plpgsql security definer set search_path=pg_catalog,public as $$
declare result public.club_stripe_connections;
begin
 if not exists(select 1 from public.profiles where id=p_actor_id and club_id=p_club_id and role='admin' and approved and active) then
  raise exception 'Club payments access refused' using errcode='42501';
 end if;
 insert into public.club_stripe_connections(club_id,platform_account_id,livemode)
 values(p_club_id,p_platform_account_id,p_livemode) on conflict(club_id,platform_account_id,livemode) do nothing;
 select * into strict result from public.club_stripe_connections
 where club_id=p_club_id and platform_account_id=p_platform_account_id and livemode=p_livemode;
 return result;
end; $$;

revoke all on function public.reserve_club_stripe_connection(uuid,text,boolean,uuid) from public,anon,authenticated,service_role;
grant execute on function public.reserve_club_stripe_connection(uuid,text,boolean,uuid) to service_role;
comment on function public.reserve_club_stripe_connection(uuid,text,boolean,uuid) is
 'Service-only same-club active approved manager Stripe setup reservation. Available before player-payments release; never changes release state. Retries preserve platform/mode-specific creation identity.';
commit;
