-- NOT-46 rollback harness. This worker owns synthetic 46490000 fixtures only.
begin;
create function pg_temp.opening_check(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end; $$;
create function pg_temp.opening_refused(statement text,expected text,label text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when others then
  if SQLSTATE=expected then return; end if;
  raise exception 'FAIL: % expected %, got %: %',label,expected,SQLSTATE,SQLERRM;
 end;
 raise exception 'FAIL: % unexpectedly succeeded',label;
end; $$;
grant execute on function pg_temp.opening_check(boolean,text),pg_temp.opening_refused(text,text,text) to authenticated,anon,service_role;
insert into public.clubs(id,name,created_at) values
 ('46490000-0000-0000-0000-000000000100','Opening test club',now()+interval '1 day'),
 ('46490000-0000-0000-0000-000000000101','Other opening club',now()+interval '1 day');
insert into public.seasons(id,club_id,label) values('46490000-0000-0000-0000-000000000102','46490000-0000-0000-0000-000000000100','Opening season');
insert into public.teams(id,club_id,key,label,is_first_team) values('46490000-0000-0000-0000-000000000103','46490000-0000-0000-0000-000000000100','xl','First Team',true);
insert into public.opponents(id,club_id,name) values('46490000-0000-0000-0000-000000000104','46490000-0000-0000-0000-000000000100','Opening opponents');
insert into public.fixtures(id,club_id,season_id,team_id,opponent_id,match_date,kickoff,venue) values
 ('46490000-0000-0000-0000-000000000105','46490000-0000-0000-0000-000000000100','46490000-0000-0000-0000-000000000102','46490000-0000-0000-0000-000000000103','46490000-0000-0000-0000-000000000104','2026-11-01','11:00','Opening pitch');
insert into auth.users(id,email,raw_user_meta_data) values
 ('46490000-0000-0000-0000-000000000010','opening.manager@example.invalid','{"first_name":"Opening","last_name":"Manager","phone":"07700900310"}'),
 ('46490000-0000-0000-0000-000000000011','opening.credit@example.invalid','{"first_name":"Credit","last_name":"Player","phone":"07700900311"}'),
 ('46490000-0000-0000-0000-000000000012','opening.arrears@example.invalid','{"first_name":"Arrears","last_name":"Player","phone":"07700900312"}'),
 ('46490000-0000-0000-0000-000000000013','opening.zero@example.invalid','{"first_name":"Zero","last_name":"Player","phone":"07700900313"}'),
 ('46490000-0000-0000-0000-000000000014','opening.activity@example.invalid','{"first_name":"Existing","last_name":"Activity","phone":"07700900314"}'),
 ('46490000-0000-0000-0000-000000000015','opening.legacy@example.invalid','{"first_name":"Legacy","last_name":"Player","phone":"07700900315"}'),
 ('46490000-0000-0000-0000-000000000016','opening.other@example.invalid','{"first_name":"Other","last_name":"Manager","phone":"07700900316"}'),
 ('46490000-0000-0000-0000-000000000017','opening.pending@example.invalid','{"first_name":"Pending","last_name":"Manager","phone":"07700900317"}'),
 ('46490000-0000-0000-0000-000000000018','opening.seed@example.invalid','{"first_name":"Service","last_name":"Seed","phone":"07700900318"}'),
 ('46490000-0000-0000-0000-000000000019','opening.second@example.invalid','{"first_name":"Second","last_name":"Manager","phone":"07700900319"}');
update public.profiles set club_id='46490000-0000-0000-0000-000000000100',approved=true where id::text like '46490000-%';
update public.profiles set role='admin' where id in('46490000-0000-0000-0000-000000000010','46490000-0000-0000-0000-000000000016','46490000-0000-0000-0000-000000000017','46490000-0000-0000-0000-000000000019');
update public.profiles set approved=false where id='46490000-0000-0000-0000-000000000017';
update public.profiles set club_id='46490000-0000-0000-0000-000000000101' where id='46490000-0000-0000-0000-000000000016';
insert into public.payments(fixture_id,profile_id,paid) values('46490000-0000-0000-0000-000000000105','46490000-0000-0000-0000-000000000015',true);
select public.post_account_entry('{"club_id":"46490000-0000-0000-0000-000000000100","profile_id":"46490000-0000-0000-0000-000000000018","kind":"opening","amount_pence":500,"source":"opening","source_id":"opening-service-seed","description":"Rehearsal opening","occurred_on":"2026-11-01"}');
select public.set_club_payments_release('46490000-0000-0000-0000-000000000100',true,true);
select public.set_club_payments_release('46490000-0000-0000-0000-000000000101',true,true);
select public.post_account_entry('{"club_id":"46490000-0000-0000-0000-000000000100","profile_id":"46490000-0000-0000-0000-000000000014","kind":"receipt","amount_pence":900,"source":"stripe_payment","source_id":"opening-existing-activity","description":"Existing receipt","occurred_on":"2026-11-02"}');
-- Prove a failed first save pins neither the effective date nor account rows.
create function pg_temp.opening_injected_failure() returns trigger language plpgsql as $$
begin
 if new.source_id='manager-opening:46490000-0000-0000-0000-000000000029' then
  raise exception 'Injected opening write failure' using errcode='P0001';
 end if;
 return new;
end; $$;
create trigger opening_test_failure before insert on public.account_entries for each row execute function pg_temp.opening_injected_failure();
set local role authenticated;
select set_config('request.jwt.claim.sub','46490000-0000-0000-0000-000000000010',true);
select pg_temp.opening_check(public.get_account_opening_summary()->'effective_on'='null'::jsonb,'service proof seed does not pin manager date');
select pg_temp.opening_check((public.get_account_opening_summary()->>'opening_credit_pence')::bigint=500,'service opening remains compatible');
select pg_temp.opening_check(public.get_player_account('46490000-0000-0000-0000-000000000015')->'entries'='[]'::jsonb,'legacy paid tick creates no financial entries');
select pg_temp.opening_refused($q$select public.record_account_opening('46490000-0000-0000-0000-000000000029','46490000-0000-0000-0000-000000000011',1800,'2026-11-30')$q$,'P0001','injected failed first save');
select pg_temp.opening_check(public.get_account_opening_summary()->'effective_on'='null'::jsonb and public.get_player_account('46490000-0000-0000-0000-000000000011')->'account_id'='null'::jsonb,'failed first save leaves date and account unset');
select pg_temp.opening_refused($q$select public.record_account_opening('46490000-0000-0000-0000-000000000030','46490000-0000-0000-0000-000000000014',0,'2026-12-01')$q$,'22023','opening cannot follow another account entry');
select pg_temp.opening_refused($q$select public.record_account_opening('46490000-0000-0000-0000-000000000030','46490000-0000-0000-0000-000000000011',null,'2026-12-01')$q$,'22023','missing amount refused');
select pg_temp.opening_refused($q$select public.record_account_opening('46490000-0000-0000-0000-000000000030','46490000-0000-0000-0000-000000000011',-2147483648,'2026-12-01')$q$,'22023','irreversible minimum refused');
select pg_temp.opening_refused($q$select public.record_account_opening('46490000-0000-0000-0000-000000000030','46490000-0000-0000-0000-000000000011',1800,'infinity')$q$,'22023','finite London date required');
select pg_temp.opening_refused($q$select public.record_account_opening('46490000-0000-0000-0000-000000000030','46490000-0000-0000-0000-000000000011',1800,null)$q$,'22023','explicit agreed date required');
select pg_temp.opening_refused($q$select public.record_account_opening('46490000-0000-0000-0000-000000000030','46490000-0000-0000-0000-000000000016',1800,'2026-12-01')$q$,'42501','cross-club opening refused');
reset role;
drop trigger opening_test_failure on public.account_entries;
set local role authenticated;
select set_config('request.jwt.claim.sub','46490000-0000-0000-0000-000000000010',true);
select public.record_account_opening('46490000-0000-0000-0000-000000000030','46490000-0000-0000-0000-000000000011',1800,'2026-12-01');
select public.record_account_opening('46490000-0000-0000-0000-000000000030','46490000-0000-0000-0000-000000000011',1800,'2026-12-01');
select pg_temp.opening_check(public.get_account_opening_summary()->>'effective_on'='2026-12-01','first successful manager save pins club date');
select pg_temp.opening_refused($q$select public.record_account_opening('46490000-0000-0000-0000-000000000031','46490000-0000-0000-0000-000000000012',-700,'2026-12-02')$q$,'22023','subsequent new opening must use club date');
select public.record_account_opening('46490000-0000-0000-0000-000000000031','46490000-0000-0000-0000-000000000012',-700,'2026-12-01');
select public.record_account_opening('46490000-0000-0000-0000-000000000032','46490000-0000-0000-0000-000000000013',0,'2026-12-01');
select public.record_account_opening('46490000-0000-0000-0000-000000000033','46490000-0000-0000-0000-000000000015',0,'2026-12-01');
do $$ declare summary jsonb; filtered jsonb; account jsonb; original uuid; begin
 summary:=public.get_account_opening_summary();
 filtered:=public.get_account_opening_summary('2026-12-01');
 perform pg_temp.opening_check((summary->>'account_count')::integer=5 and (summary->>'credit_count')::integer=2 and (summary->>'arrears_count')::integer=1 and (summary->>'settled_count')::integer=2,'separate account direction counts');
 perform pg_temp.opening_check((summary->>'opening_credit_pence')::bigint=2300 and (summary->>'opening_arrears_pence')::bigint=700 and (summary->>'net_opening_pence')::bigint=1600,'absolute arrears total separate from credit and net');
 perform pg_temp.opening_check((filtered->>'account_count')::integer=4 and (filtered->>'opening_credit_pence')::bigint=1800 and (filtered->>'opening_arrears_pence')::bigint=700 and (filtered->>'net_opening_pence')::bigint=1100,'exact effective date filter');
 perform pg_temp.opening_check(filtered->>'effective_on'='2026-12-01' and filtered->>'filter_effective_on'='2026-12-01','summary distinguishes agreed and filtered date');
 account:=public.get_player_account('46490000-0000-0000-0000-000000000011');
 original:=(account->'entries'->0->>'id')::uuid;
 perform pg_temp.opening_check(jsonb_array_length(account->'entries')=1 and account->'entries'->0->>'description'='Opening balance' and account->'entries'->0->>'occurred_on'='2026-12-01' and (account->>'balance_pence')::bigint=1800,'18 GBP opening credit first entry once');
 perform pg_temp.opening_check((public.get_player_account('46490000-0000-0000-0000-000000000012')->>'balance_pence')::bigint=-700,'7 GBP opening arrears');
 perform pg_temp.opening_check((public.get_player_account('46490000-0000-0000-0000-000000000013')->>'balance_pence')::bigint=0,'zero opening settled');
 perform pg_temp.opening_check(jsonb_array_length(public.get_player_account('46490000-0000-0000-0000-000000000015')->'entries')=1 and (public.get_activity_finance_report('2026-11-01','2026-12-02')->'receipts'->>'gross_pence')::bigint=900,'legacy tick never reconstructed as fee or receipt');
 perform public.record_account_receipt('46490000-0000-0000-0000-000000000040','46490000-0000-0000-0000-000000000011',900,'bank','Later receipt','2026-12-02');
 perform pg_temp.opening_check(public.record_account_opening('46490000-0000-0000-0000-000000000030','46490000-0000-0000-0000-000000000011',1800,'2026-12-01')=original,'exact saved opening acknowledged after later activity');
 perform pg_temp.opening_check((public.get_player_account('46490000-0000-0000-0000-000000000011')->>'balance_pence')::bigint=2700,'later receipt retained after opening replay');
 perform pg_temp.opening_check(public.get_account_opening_summary()=summary,'receipts do not alter cutover totals');
 perform pg_temp.opening_check((public.get_activity_finance_report('2026-11-01','2026-12-02')->'receipts'->>'gross_pence')::bigint=1800 and (public.get_activity_finance_report('2026-11-01','2026-12-02')->'totals'->>'net_charges_pence')::bigint=0,'openings excluded from receipts and activity charges');
end; $$;
select pg_temp.opening_refused($q$select public.record_account_opening('46490000-0000-0000-0000-000000000030','46490000-0000-0000-0000-000000000011',1801,'2026-12-01')$q$,'22023','changed amount under same request conflicts');
select pg_temp.opening_refused($q$select public.record_account_opening('46490000-0000-0000-0000-000000000030','46490000-0000-0000-0000-000000000011',1800,'2026-12-02')$q$,'22023','changed date under same request conflicts');
select pg_temp.opening_refused($q$select public.record_account_opening('46490000-0000-0000-0000-000000000030','46490000-0000-0000-0000-000000000019',1800,'2026-12-01')$q$,'22023','changed player under same request conflicts');
select pg_temp.opening_refused($q$select public.record_account_opening('46490000-0000-0000-0000-000000000041','46490000-0000-0000-0000-000000000011',1800,'2026-12-01')$q$,'22023','second request cannot duplicate saved opening');
select pg_temp.opening_refused($q$select public.get_account_opening_summary('infinity')$q$,'22023','summary finite filter only');
select pg_temp.opening_check((public.get_account_opening_summary('2026-12-02')->>'account_count')::integer=0 and public.get_account_opening_summary('2026-12-02')->>'effective_on'='2026-12-01','empty filtered totals preserve agreed club date');
select pg_temp.opening_refused($q$update public.club_account_opening_cutover set effective_on='2026-12-02'$q$,'42501','manager cannot reset date directly');
select set_config('request.jwt.claim.sub','46490000-0000-0000-0000-000000000019',true);
select pg_temp.opening_refused($q$select public.record_account_opening('46490000-0000-0000-0000-000000000030','46490000-0000-0000-0000-000000000011',1800,'2026-12-01')$q$,'22023','changed actor conflicts');
select set_config('request.jwt.claim.sub','46490000-0000-0000-0000-000000000011',true);
select pg_temp.opening_refused($q$select public.record_account_opening('46490000-0000-0000-0000-000000000042','46490000-0000-0000-0000-000000000011',1,'2026-12-01')$q$,'42501','player cannot post opening');
select pg_temp.opening_refused($q$select public.get_account_opening_summary()$q$,'42501','player cannot see club totals');
select pg_temp.opening_check((public.get_player_account()->>'balance_pence')::bigint=2700,'player sees own opening and subsequent balance');
select set_config('request.jwt.claim.sub','46490000-0000-0000-0000-000000000016',true);
select pg_temp.opening_check((public.get_account_opening_summary()->>'account_count')::integer=0 and public.get_account_opening_summary()->'effective_on'='null'::jsonb,'other club manager sees only own empty cutover');
select pg_temp.opening_refused($q$select public.record_account_opening('46490000-0000-0000-0000-000000000042','46490000-0000-0000-0000-000000000011',1,'2026-12-01')$q$,'42501','other club manager cannot post opening');
select set_config('request.jwt.claim.sub','46490000-0000-0000-0000-000000000017',true);
select pg_temp.opening_refused($q$select public.get_account_opening_summary()$q$,'42501','unapproved manager refused');
reset role;
select pg_temp.opening_check((select count(*)=1 from public.legacy_payment_history where fixture_id='46490000-0000-0000-0000-000000000105' and paid),'legacy history unchanged');
select pg_temp.opening_refused($q$update public.club_account_opening_cutover set effective_on='2026-12-02' where club_id='46490000-0000-0000-0000-000000000100'$q$,'42501','cutover date immutable even via owner update');
select public.set_club_payments_release('46490000-0000-0000-0000-000000000100',false,false);
set local role authenticated;
select set_config('request.jwt.claim.sub','46490000-0000-0000-0000-000000000010',true);
select pg_temp.opening_refused($q$select public.record_account_opening('46490000-0000-0000-0000-000000000030','46490000-0000-0000-0000-000000000011',1800,'2026-12-01')$q$,'42501','pause gates even saved request retry');
select pg_temp.opening_refused($q$select public.get_account_opening_summary()$q$,'42501','pause gates club summary');
reset role;
set local role anon;
select pg_temp.opening_refused($q$select public.get_account_opening_summary()$q$,'42501','anonymous totals refused');
select pg_temp.opening_refused($q$select public.record_account_opening('46490000-0000-0000-0000-000000000042','46490000-0000-0000-0000-000000000011',1,'2026-12-01')$q$,'42501','anonymous opening refused');
reset role;
select 'ALL MANAGER OPENING BALANCE TESTS PASSED';
rollback;
