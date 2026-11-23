-- Apply after 0042. No network call is made by this migration. The worker's
-- endpoint must be deployed before the owner sets Vault training_push_url.
-- Existing hourly match/availability reminders and their cron job are untouched.
begin;
create function public.dispatch_training_push_due() returns bigint
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_url text; v_secret text; v_request bigint;
begin
 -- A minute tick with no pending/expired work makes no Edge Function request.
 if not exists (
  select 1 from public.training_push_outbox o
  where (o.state='pending' or (o.state='leased' and o.locked_until<now()))
   and o.available_at<=now()
 ) then return null; end if;
 -- Local/offline installations have no Vault/net extensions: safe no-op.
 if to_regclass('vault.decrypted_secrets') is null then return null; end if;
 select decrypted_secret into v_url from vault.decrypted_secrets where name='training_push_url' limit 1;
 select decrypted_secret into v_secret from vault.decrypted_secrets where name='reminders_cron_secret' limit 1;
 if coalesce(v_url,'')='' or coalesce(v_secret,'')='' then return null; end if;
 -- Vault is owner-managed. Limit this endpoint to the private Supabase worker;
 -- never permit a profile or client-controlled URL to receive the cron secret.
 if v_url !~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/run-training-push$' then
  raise exception 'Check the training push worker URL in Vault';
 end if;
 select net.http_post(
  url:=v_url,
  headers:=jsonb_build_object('content-type','application/json','x-cron-secret',v_secret),
  body:='{}'::jsonb,
  timeout_milliseconds:=90000
 ) into v_request;
 return v_request;
end;
$$;
revoke all on function public.dispatch_training_push_due() from public,anon,authenticated,service_role;

-- pg_cron/pg_net are hosted setup, not a prerequisite for local RLS proof.
-- cron.schedule updates an existing job of this name without creating a twin.
do $$
begin
 if exists(select 1 from pg_extension where extname='pg_cron')
  and exists(select 1 from pg_extension where extname='pg_net') then
  perform cron.schedule('training-push-minute','* * * * *','select public.dispatch_training_push_due()');
 end if;
end;
$$;
comment on function public.dispatch_training_push_due() is 'Owner-only due-work dispatcher. No HTTP before Vault training_push_url and reminders_cron_secret are configured. Does not change the hourly reminders job.';
commit;
