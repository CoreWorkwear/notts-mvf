-- 0058 rollback proof. Synthetic namespace 31580000, no provider calls.
-- Run after 0058 + app seed; all fixtures and bindings roll back.
begin;
create function pg_temp.setup_check(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end; $$;
create function pg_temp.setup_refused(statement text,expected text,label text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when others then
  if SQLSTATE=expected then return; end if;
  raise exception 'FAIL: % expected %, got %: %',label,expected,SQLSTATE,SQLERRM;
 end;
 raise exception 'FAIL: % unexpectedly succeeded',label;
end; $$;
grant execute on function pg_temp.setup_check(boolean,text),pg_temp.setup_refused(text,text,text) to authenticated,anon,service_role;
insert into public.clubs(id,name,created_at) values
 ('31580000-0000-0000-0000-000000000100','Setup before release club',now()+interval '1 day'),
 ('31580000-0000-0000-0000-000000000101','Other setup club',now()+interval '1 day');
insert into auth.users(id,email,raw_user_meta_data) values
 ('31580000-0000-0000-0000-000000000010','setupoff.manager@example.invalid','{"first_name":"Setup","last_name":"Manager","phone":"07700900910"}'),
 ('31580000-0000-0000-0000-000000000011','setupoff.player@example.invalid','{"first_name":"Setup","last_name":"Player","phone":"07700900911"}'),
 ('31580000-0000-0000-0000-000000000012','setupoff.pending@example.invalid','{"first_name":"Pending","last_name":"Manager","phone":"07700900912"}'),
 ('31580000-0000-0000-0000-000000000013','setupoff.inactive@example.invalid','{"first_name":"Inactive","last_name":"Manager","phone":"07700900913"}'),
 ('31580000-0000-0000-0000-000000000014','setupoff.other@example.invalid','{"first_name":"Other","last_name":"Manager","phone":"07700900914"}');
update public.profiles set club_id='31580000-0000-0000-0000-000000000100',approved=true where id::text like '31580000-%';
update public.profiles set role='admin' where id in('31580000-0000-0000-0000-000000000010','31580000-0000-0000-0000-000000000012','31580000-0000-0000-0000-000000000013','31580000-0000-0000-0000-000000000014');
update public.profiles set approved=false where id='31580000-0000-0000-0000-000000000012';
update public.profiles set active=false where id='31580000-0000-0000-0000-000000000013';
update public.profiles set club_id='31580000-0000-0000-0000-000000000101' where id='31580000-0000-0000-0000-000000000014';
select pg_temp.setup_check(not exists(select 1 from public.club_payments_release where club_id='31580000-0000-0000-0000-000000000100'),'new club defaults to release off without a setting row');
set local role service_role;
do $$ declare first public.club_stripe_connections; replay public.club_stripe_connections; begin
 first:=public.reserve_club_stripe_connection('31580000-0000-0000-0000-000000000100','acct_setupPlatform',false,'31580000-0000-0000-0000-000000000010');
 replay:=public.reserve_club_stripe_connection('31580000-0000-0000-0000-000000000100','acct_setupPlatform',false,'31580000-0000-0000-0000-000000000010');
 perform pg_temp.setup_check(first.creation_id=replay.creation_id and first.creation_started_at=replay.creation_started_at,'default-off setup retries preserve creation identity and time');
 perform pg_temp.setup_check(first.stripe_account_id is null and not first.charges_enabled and not first.payouts_enabled,'reservation alone never invents provider readiness');
end; $$;
select pg_temp.setup_refused($q$select public.reserve_club_stripe_connection('31580000-0000-0000-0000-000000000100','acct_setupPlatform',false,'31580000-0000-0000-0000-000000000011')$q$,'42501','ordinary player denied');
select pg_temp.setup_refused($q$select public.reserve_club_stripe_connection('31580000-0000-0000-0000-000000000100','acct_setupPlatform',false,'31580000-0000-0000-0000-000000000012')$q$,'42501','unapproved manager denied');
select pg_temp.setup_refused($q$select public.reserve_club_stripe_connection('31580000-0000-0000-0000-000000000100','acct_setupPlatform',false,'31580000-0000-0000-0000-000000000013')$q$,'42501','inactive manager denied');
select pg_temp.setup_refused($q$select public.reserve_club_stripe_connection('31580000-0000-0000-0000-000000000100','acct_setupPlatform',false,'31580000-0000-0000-0000-000000000014')$q$,'42501','other-club manager denied');
select pg_temp.setup_refused($q$select public.reserve_club_stripe_connection('31580000-0000-0000-0000-000000000101','acct_setupPlatform',false,'31580000-0000-0000-0000-000000000010')$q$,'42501','manager cannot reserve another club');
select pg_temp.setup_refused($q$select public.reserve_club_stripe_connection('31580000-0000-0000-0000-000000000100','acct_setupPlatform',false,null)$q$,'42501','missing manager denied');
select pg_temp.setup_refused($q$insert into public.club_stripe_connections(club_id,platform_account_id,livemode) values('31580000-0000-0000-0000-000000000100','acct_forged',false)$q$,'42501','direct service write remains refused');
reset role;
select pg_temp.setup_check(not exists(select 1 from public.club_payments_release where club_id='31580000-0000-0000-0000-000000000100'),'setup never creates or enables release setting');
-- Existing explicit-off release state, including historical cutover, is not
-- rewritten by a setup retry, separate mode or eventual provider binding.
insert into public.club_payments_release(club_id,enabled,cutover_at,changed_at) values
 ('31580000-0000-0000-0000-000000000100',false,'2026-11-01 12:00Z','2026-11-02 12:00Z');
create temporary table setup_release_before as select to_jsonb(r) snapshot from public.club_payments_release r where club_id='31580000-0000-0000-0000-000000000100';
set local role service_role;
do $$ declare test_row public.club_stripe_connections; live_row public.club_stripe_connections; other_platform public.club_stripe_connections; replay public.club_stripe_connections; begin
 test_row:=public.reserve_club_stripe_connection('31580000-0000-0000-0000-000000000100','acct_setupPlatform',false,'31580000-0000-0000-0000-000000000010');
 live_row:=public.reserve_club_stripe_connection('31580000-0000-0000-0000-000000000100','acct_setupPlatform',true,'31580000-0000-0000-0000-000000000010');
 other_platform:=public.reserve_club_stripe_connection('31580000-0000-0000-0000-000000000100','acct_otherSetupPlatform',false,'31580000-0000-0000-0000-000000000010');
 perform pg_temp.setup_check(test_row.creation_id<>live_row.creation_id and test_row.creation_id<>other_platform.creation_id,'provider modes and platforms retain separate reservations');
 perform pg_temp.setup_refused(format('select public.save_club_stripe_connection(%L,%L,true,%L,%L,%L::jsonb)','31580000-0000-0000-0000-000000000100','acct_setupPlatform',test_row.creation_id,'acct_setupLive','{}'),'22023','test creation reference cannot bind live reservation');
 perform public.save_club_stripe_connection('31580000-0000-0000-0000-000000000100','acct_setupPlatform',false,test_row.creation_id,'acct_setupClub','{"charges_enabled":true,"payouts_enabled":true}');
 replay:=public.reserve_club_stripe_connection('31580000-0000-0000-0000-000000000100','acct_setupPlatform',false,'31580000-0000-0000-0000-000000000010');
 perform pg_temp.setup_check(replay.creation_id=test_row.creation_id and replay.stripe_account_id='acct_setupClub','bound setup retry preserves identity and connected account while off');
 perform pg_temp.setup_check((select stripe_account_id is null from public.club_stripe_connections where club_id='31580000-0000-0000-0000-000000000100' and platform_account_id='acct_setupPlatform' and livemode),'failed cross-mode bind left live reservation unbound');
 perform public.reserve_club_stripe_connection('31580000-0000-0000-0000-000000000101','acct_setupPlatform',false,'31580000-0000-0000-0000-000000000014');
end; $$;
reset role;
select pg_temp.setup_check((select to_jsonb(r)=b.snapshot from public.club_payments_release r cross join pg_temp.setup_release_before b where r.club_id='31580000-0000-0000-0000-000000000100'),'setup and binding leave explicit-off release row byte-for-byte unchanged');
select pg_temp.setup_check(not exists(select 1 from public.player_accounts where club_id='31580000-0000-0000-0000-000000000100') and not exists(select 1 from public.account_entries where club_id='31580000-0000-0000-0000-000000000100'),'setup does not open player accounts or post money');
set local role authenticated;
select set_config('request.jwt.claim.sub','31580000-0000-0000-0000-000000000010',true);
select pg_temp.setup_refused($q$select public.reserve_club_stripe_connection('31580000-0000-0000-0000-000000000100','acct_setupPlatform',false,'31580000-0000-0000-0000-000000000010')$q$,'42501','even manager browser cannot call service-only reservation directly');
select pg_temp.setup_check((public.payments_release_status()->>'enabled')='false','manager UI release status stays off');
select pg_temp.setup_refused($q$select public.record_account_receipt('31580000-0000-0000-0000-000000000020','31580000-0000-0000-0000-000000000011',900,'bank')$q$,'42501','manual money writes remain gated while setup succeeds');
select set_config('request.jwt.claim.sub','31580000-0000-0000-0000-000000000011',true);
select pg_temp.setup_refused($q$select public.get_player_account()$q$,'42501','player account read remains gated');
reset role;
set local role service_role;
select pg_temp.setup_refused($q$select public.stripe_player_quote('31580000-0000-0000-0000-000000000100','31580000-0000-0000-0000-000000000011')$q$,'42501','player checkout quote remains gated');
reset role;
set local role anon;
select pg_temp.setup_refused($q$select public.reserve_club_stripe_connection('31580000-0000-0000-0000-000000000100','acct_setupPlatform',false,'31580000-0000-0000-0000-000000000010')$q$,'42501','anonymous setup reservation refused');
reset role;
select 'ALL STRIPE SETUP BEFORE RELEASE TESTS PASSED';
rollback;
