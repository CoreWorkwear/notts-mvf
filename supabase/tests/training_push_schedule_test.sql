-- LOCAL ISOLATED POSTGRES ONLY. Stubbed HTTP/Vault; never makes a network call.
-- Apply 0041/0042/0043 first. Everything here rolls back, including fixtures.
begin;
do $$ begin
 if to_regnamespace('vault') is not null or to_regnamespace('net') is not null then
  raise exception 'Use an isolated local database without live Vault/net extensions';
 end if;
end $$;
create schema vault;
create table vault.decrypted_secrets(name text,decrypted_secret text);
create schema net;
create table net.proof_requests(url text,headers jsonb,body jsonb,timeout_ms integer);
create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer)
returns bigint language plpgsql as $$ begin
 insert into net.proof_requests values(url,headers,body,timeout_milliseconds);
 return 12345;
end $$;

do $$
declare v_session uuid; v_notice uuid; v_profile uuid; v_club uuid; v_result bigint;
begin
 if has_function_privilege('anon','public.dispatch_training_push_due()','execute')
  or has_function_privilege('authenticated','public.dispatch_training_push_due()','execute')
  or has_function_privilege('service_role','public.dispatch_training_push_due()','execute') then
  raise exception 'S1 dispatcher must be owner-only';
 end if;
 -- Isolated fixture namespace, independent of any browser proof sessions.
 select id,club_id into v_profile,v_club from public.profiles where role='admin' limit 1;
 if v_profile is null then raise exception 'Seed one local admin first'; end if;
 insert into public.training_sessions(club_id,start_date,start_time,venue,audience)
 values(v_club,current_date+10,'19:00','Scheduler proof','club') returning id into v_session;
 insert into public.training_notices(session_id,club_id,kind,title,body)
 values(v_session,v_club,'moved','Training moved','Synthetic notice') returning id into v_notice;
 insert into public.training_push_outbox(notice_id,profile_id,push_token_id,device_token,title,body,tag,url,can_reply)
 values(v_notice,v_profile,gen_random_uuid(),'{}','Training moved','Synthetic','training-proof','/training',false);

 -- Due work is harmless until the release owner enables the endpoint.
 if public.dispatch_training_push_due() is not null then raise exception 'S2 no configuration must no-op'; end if;
 insert into vault.decrypted_secrets values('training_push_url','https://synthetic.supabase.co/functions/v1/run-training-push');
 if public.dispatch_training_push_due() is not null then raise exception 'S3 no secret must no-op'; end if;
 insert into vault.decrypted_secrets values('reminders_cron_secret','synthetic-only');
 v_result:=public.dispatch_training_push_due();
 if v_result<>12345 or (select count(*) from net.proof_requests)<>1 then raise exception 'S4 due work should dispatch once'; end if;
 if not exists(select 1 from net.proof_requests where headers->>'x-cron-secret'='synthetic-only' and timeout_ms=90000 and body='{}'::jsonb) then
  raise exception 'S5 cron header/body/deadline mismatch';
 end if;

 -- Pending backoff and active leases are not due, so no empty HTTP call.
 update public.training_push_outbox set available_at=now()+interval '10 minutes' where notice_id=v_notice;
 -- Other workers own any pre-existing fixtures in this isolated database.
 if not exists(select 1 from public.training_push_outbox where notice_id<>v_notice and available_at<=now() and (state='pending' or (state='leased' and locked_until<now()))) then
  if public.dispatch_training_push_due() is not null then raise exception 'S6 future work must no-op'; end if;
 end if;
 update public.training_push_outbox set available_at=now(),state='leased',locked_until=now()+interval '2 minutes' where notice_id=v_notice;
 if not exists(select 1 from public.training_push_outbox where notice_id<>v_notice and available_at<=now() and (state='pending' or (state='leased' and locked_until<now()))) then
  if public.dispatch_training_push_due() is not null then raise exception 'S7 active lease must no-op'; end if;
 end if;
 update public.training_push_outbox set locked_until=now()-interval '1 second' where notice_id=v_notice;
 if public.dispatch_training_push_due()<>12345 then raise exception 'S8 expired lease must dispatch'; end if;
 update vault.decrypted_secrets set decrypted_secret='https://attacker.invalid/' where name='training_push_url';
 begin
  perform public.dispatch_training_push_due();
  raise exception 'S9 bad endpoint accepted';
 exception when raise_exception then
  if sqlerrm='S9 bad endpoint accepted' then raise; end if;
 end;
 raise notice 'TRAINING SCHEDULER S1-S9 PASSED (stub HTTP only)';
end $$;
rollback;
