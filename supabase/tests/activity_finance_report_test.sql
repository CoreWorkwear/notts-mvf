-- NOT-51 read-only report proof. Synthetic namespace owned by ledger worker.
-- Run after 0047 + seed. Financial fixture writes and all assertions roll back.
begin;
create function pg_temp.report_check(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end; $$;
create function pg_temp.report_refused(statement text,expected text,label text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when others then
  if SQLSTATE=expected then return; end if;
  raise exception 'FAIL: % expected %, got %: %',label,expected,SQLSTATE,SQLERRM;
 end;
 raise exception 'FAIL: % unexpectedly succeeded',label;
end; $$;
grant execute on function pg_temp.report_check(boolean,text),pg_temp.report_refused(text,text,text) to authenticated,anon;
insert into public.clubs(id,name,created_at) values
 ('51470000-0000-0000-0000-000000000100','Report test club',now()+interval '1 day'),
 ('51470000-0000-0000-0000-000000000101','Other report club',now()+interval '1 day');
insert into public.seasons(id,club_id,label) values('51470000-0000-0000-0000-000000000102','51470000-0000-0000-0000-000000000100','Report season');
insert into public.teams(id,club_id,key,label,is_first_team) values('51470000-0000-0000-0000-000000000103','51470000-0000-0000-0000-000000000100','xl','First Team',true);
insert into auth.users(id,email,raw_user_meta_data) values
 ('51470000-0000-0000-0000-000000000010','report.manager@example.invalid','{"first_name":"Report","last_name":"Manager","phone":"07700900110"}'),
 ('51470000-0000-0000-0000-000000000011','report.player@example.invalid','{"first_name":"Report","last_name":"Player","phone":"07700900111"}'),
 ('51470000-0000-0000-0000-000000000012','report.other@example.invalid','{"first_name":"Other","last_name":"Manager","phone":"07700900112"}'),
 ('51470000-0000-0000-0000-000000000013','report.pending@example.invalid','{"first_name":"Pending","last_name":"Manager","phone":"07700900113"}');
update public.profiles set club_id='51470000-0000-0000-0000-000000000100',approved=true where id::text like '51470000-%';
update public.profiles set role='admin' where id in('51470000-0000-0000-0000-000000000010','51470000-0000-0000-0000-000000000012','51470000-0000-0000-0000-000000000013');
update public.profiles set approved=false where id='51470000-0000-0000-0000-000000000013';
update public.profiles set club_id='51470000-0000-0000-0000-000000000101' where id='51470000-0000-0000-0000-000000000012';
insert into public.opponents(id,club_id,name) values('51470000-0000-0000-0000-000000000020','51470000-0000-0000-0000-000000000100','Report opponents');
insert into public.fixtures(id,club_id,season_id,team_id,opponent_id,match_date,kickoff,venue) values
 ('51470000-0000-0000-0000-000000000021','51470000-0000-0000-0000-000000000100','51470000-0000-0000-0000-000000000102','51470000-0000-0000-0000-000000000103','51470000-0000-0000-0000-000000000020','2027-03-27','11:00','Report pitch');
insert into public.training_sessions(id,club_id,start_date,start_time,venue,audience) values
 ('51470000-0000-0000-0000-000000000022','51470000-0000-0000-0000-000000000100','2027-03-27','19:00','Report training','club');
select public.set_club_payments_release('51470000-0000-0000-0000-000000000100',true,true);
select public.set_club_payments_release('51470000-0000-0000-0000-000000000101',true,true);
create function pg_temp.report_post(k text,a integer,s text,sid text,d date,cat text default null,
 activity text default null,aid uuid default null,snapshot jsonb default '{}',linked uuid default null)
 returns uuid language sql as $$
 select public.post_account_entry(jsonb_build_object('club_id','51470000-0000-0000-0000-000000000100',
 'profile_id','51470000-0000-0000-0000-000000000011','kind',k,'amount_pence',a,'source',s,'source_id',sid,
 'description',sid,'occurred_on',d,'category',cat,'activity_type',activity,'activity_id',aid,'activity_snapshot',snapshot,
 'linked_entry_id',linked,'actor_id','51470000-0000-0000-0000-000000000010'));
$$;
select pg_temp.report_post('opening',10000,'opening','report-opening','2027-03-27');
select pg_temp.report_post('receipt',3000,'stripe_payment','report-stripe','2027-03-27');
select pg_temp.report_post('receipt',900,'bank','report-bank','2027-03-26');
select pg_temp.report_post('receipt',600,'cash','report-cash','2027-03-26');
select pg_temp.report_post('adjustment',-200,'adjustment','report-adjustment','2027-03-27');
select pg_temp.report_post('charge',-700,'match','report-match','2027-03-27','first_team','fixture','51470000-0000-0000-0000-000000000021','{"team":"First Team","opponent":"Report opponents","date":"2027-03-27"}');
select pg_temp.report_post('charge',-400,'training','report-training','2027-03-27','training','training_session','51470000-0000-0000-0000-000000000022','{"venue":"Report training","date":"2027-03-27"}');
select pg_temp.report_post('charge',-500,'fine','report-fine','2027-03-27','fines','fine','51470000-0000-0000-0000-000000000023','{"reason":"Late arrival"}');
select pg_temp.report_post('reversal',500,'reversal','report-fine-reversal','2027-03-28',linked=>(select id from public.account_entries where source_id='report-fine'));
select pg_temp.report_post('reversal',-900,'reversal','report-bank-reversal','2027-03-28',linked=>(select id from public.account_entries where source_id='report-bank'));
select pg_temp.report_post('refund',-500,'stripe_refund','report-refund','2027-03-28',linked=>(select id from public.account_entries where source_id='report-stripe'));
-- Match 0054's verified succeeded-then-failed refund correction shape. The
-- service-only settlement path inserts this linked credit without rewriting
-- the original debit; it is not a new receipt or a charge correction.
insert into public.account_entries(account_id,club_id,kind,amount_pence,description,reference,source,source_id,
 occurred_on,linked_entry_id,request_payload)
 select account_id,club_id,'reversal',500,'Stripe refund failed','re_reportFailed','reversal','report-refund-failed',
 '2027-03-30',id,'{"provider_verified":true}' from public.account_entries where source_id='report-refund';
select pg_temp.report_post('reversal',200,'reversal','report-adjustment-reversal','2027-03-28',linked=>(select id from public.account_entries where source_id='report-adjustment'));
-- A different club's money must not leak into any count or report line.
select public.post_account_entry('{"club_id":"51470000-0000-0000-0000-000000000101","profile_id":"51470000-0000-0000-0000-000000000012","kind":"receipt","amount_pence":99999,"source":"cash","source_id":"other-club-receipt","description":"Other club money","occurred_on":"2027-03-27"}');
-- Simulate a later squad/name change; category and player snapshot stay historical.
delete from public.team_memberships where profile_id='51470000-0000-0000-0000-000000000011';
update public.profiles set first_name='Changed' where id='51470000-0000-0000-0000-000000000011';
set local role authenticated;
select set_config('request.jwt.claim.sub','51470000-0000-0000-0000-000000000010',true);
do $$ declare r jsonb; next_r jsonb; combined jsonb; empty_r jsonb; recovered jsonb; whole_r jsonb; c jsonb; begin
 r:=public.get_activity_finance_report('2027-03-27','2027-03-27');
 perform pg_temp.report_check(jsonb_array_length(r->'categories')=4,'all four categories including zero');
 perform pg_temp.report_check((r->'categories'->0->>'net_charges_pence')::bigint=700,'First Team charge');
 perform pg_temp.report_check((r->'categories'->1->>'net_charges_pence')::bigint=0 and r->'categories'->1->'entries'='[]'::jsonb,'Community zero');
 perform pg_temp.report_check((r->'categories'->2->>'net_charges_pence')::bigint=400,'Training charge');
 perform pg_temp.report_check((r->'categories'->3->>'net_charges_pence')::bigint=500,'Fine charge');
 perform pg_temp.report_check((r->'totals'->>'net_charges_pence')::bigint=1600 and (r->'totals'->>'charge_count')::integer=3,'only three charges total 16 GBP');
 perform pg_temp.report_check((r->'receipts'->>'gross_pence')::bigint=3000 and (r->'receipts'->>'receipt_count')::integer=1,'30 GBP receipt separate from 16 GBP activity charges');
 perform pg_temp.report_check((r->'receipts'->'methods'->0->>'gross_pence')::bigint=3000 and (r->'receipts'->'methods'->1->>'gross_pence')::bigint=0 and (r->'receipts'->'methods'->2->>'gross_pence')::bigint=0,'period excludes earlier bank and cash receipts');
 perform pg_temp.report_check(r->'categories'->0->'entries'->0->>'player_name'='Report Player','historical player name retained');
 perform pg_temp.report_check(r->'categories'->0->'entries'->0->'activity_snapshot'->>'team'='First Team','historic category survives squad change');
 next_r:=public.get_activity_finance_report('2027-03-28','2027-03-28');
 perform pg_temp.report_check((next_r->'totals'->>'charges_pence')::bigint=0 and (next_r->'totals'->>'corrections_pence')::bigint=-500 and (next_r->'totals'->>'net_charges_pence')::bigint=-500,'next period only fine correction');
 perform pg_temp.report_check((next_r->'categories'->3->>'correction_count')::integer=1 and jsonb_array_length(next_r->'categories'->3->'entries')=1,'one correction line');
 perform pg_temp.report_check(next_r->'categories'->3->'entries'->0->>'original_occurred_on'='2027-03-27' and next_r->'categories'->3->'entries'->0->>'occurred_on'='2027-03-28','inclusive London correction accounting dates across BST start');
 perform pg_temp.report_check(next_r->'categories'->3->'entries'->0->'activity_snapshot'->>'reason'='Late arrival' and next_r->'categories'->3->'entries'->0->>'original_charge_id'=r->'categories'->3->'entries'->0->>'id','correction links original reason and id');
 perform pg_temp.report_check((next_r->'receipts'->>'gross_pence')::bigint=0 and (next_r->'receipts'->>'refunds_pence')::bigint=-500 and (next_r->'receipts'->>'reversals_pence')::bigint=-900 and (next_r->'receipts'->>'net_pence')::bigint=-1400,'receipt reconciliation signed refunds and reversal');
 perform pg_temp.report_check((next_r->'receipts'->>'refund_count')::integer=1 and (next_r->'receipts'->>'reversal_count')::integer=1 and jsonb_array_length(next_r->'receipts'->'entries')=2,'receipt corrections identifiable with counts and detail');
 recovered:=public.get_activity_finance_report('2027-03-30','2027-03-30');
 perform pg_temp.report_check((recovered->'receipts'->>'refunds_pence')::bigint=500 and (recovered->'receipts'->>'net_pence')::bigint=500,
  'failed refund restores refund and net totals on its own reversal date');
 perform pg_temp.report_check((recovered->'receipts'->>'gross_pence')::bigint=0 and (recovered->'receipts'->>'receipt_count')::integer=0
  and (recovered->'receipts'->>'reversals_pence')::bigint=0 and (recovered->'receipts'->>'reversal_count')::integer=0,
  'refund correction never becomes gross money or an ordinary receipt reversal');
 perform pg_temp.report_check((recovered->'totals'->>'charges_pence')::bigint=0 and (recovered->'totals'->>'corrections_pence')::bigint=0
  and (recovered->'totals'->>'net_charges_pence')::bigint=0,'refund failure never alters activity charges');
 perform pg_temp.report_check(jsonb_array_length(recovered->'receipts'->'entries')=1
  and recovered->'receipts'->'entries'->0->>'method'='stripe'
  and recovered->'receipts'->'entries'->0->>'kind'='reversal'
  and (recovered->'receipts'->'entries'->0->>'reverses_refund')::boolean
  and recovered->'receipts'->'entries'->0->>'original_receipt_id'=r->'receipts'->'entries'->0->>'id'
  and recovered->'receipts'->'entries'->0->>'linked_entry_id'=next_r->'receipts'->'entries'->1->>'id',
  'one immutable corrective export line traces refund back to original Stripe method');
 perform pg_temp.report_check((recovered->'receipts'->'methods'->0->>'refunds_pence')::bigint=500
  and (recovered->'receipts'->'methods'->1->>'net_pence')::bigint=0
  and (recovered->'receipts'->'methods'->2->>'net_pence')::bigint=0,'refund correction is Stripe-only');
 combined:=public.get_activity_finance_report('2027-03-26','2027-03-28');
 perform pg_temp.report_check((combined->'receipts'->>'gross_pence')::bigint=4500 and (combined->'receipts'->>'receipt_count')::integer=3 and (combined->'receipts'->'methods'->0->>'gross_pence')::bigint=3000 and (combined->'receipts'->'methods'->1->>'gross_pence')::bigint=900 and (combined->'receipts'->'methods'->2->>'gross_pence')::bigint=600,'separate gross Stripe bank cash and counts');
 perform pg_temp.report_check((combined->'totals'->>'net_charges_pence')::bigint=1100 and (combined->'receipts'->>'net_pence')::bigint=3100,'inclusive combined totals');
 whole_r:=public.get_activity_finance_report('2027-03-26','2027-03-30');
 perform pg_temp.report_check((whole_r->'receipts'->>'gross_pence')::bigint=4500 and (whole_r->'receipts'->>'refunds_pence')::bigint=0
  and (whole_r->'receipts'->>'reversals_pence')::bigint=-900 and (whole_r->'receipts'->>'net_pence')::bigint=3600,
  'refund and corrective credit offset once without doubling gross or altering bank reversal');
 perform pg_temp.report_check((select sum((value->>'amount_pence')::bigint) from jsonb_array_elements(whole_r->'receipts'->'entries'))
  =(whole_r->'receipts'->>'net_pence')::bigint,'receipt export lines sum exactly to corrected net');
 perform pg_temp.report_check((public.get_activity_finance_report('2027-03-26','2027-03-30')->'receipts'->>'net_pence')::bigint=3600,
  'repeated reporting never reapplies a corrective credit');
 for c in select value from jsonb_array_elements(combined->'categories') loop
  perform pg_temp.report_check((select coalesce(sum((value->>'amount_pence')::bigint),0) from jsonb_array_elements(c->'entries'))=(c->>'net_charges_pence')::bigint,'category detail sums to net');
 end loop;
 perform pg_temp.report_check((select sum((value->>'net_charges_pence')::bigint) from jsonb_array_elements(combined->'categories'))=(combined->'totals'->>'net_charges_pence')::bigint,'category totals sum to grand total');
 empty_r:=public.get_activity_finance_report('2027-03-29','2027-03-29');
 perform pg_temp.report_check((empty_r->'totals'->>'net_charges_pence')::bigint=0 and (empty_r->'receipts'->>'net_pence')::bigint=0 and jsonb_array_length(empty_r->'categories')=4 and jsonb_array_length(empty_r->'receipts'->'methods')=3,'empty period complete zero shape');
end; $$;
select pg_temp.report_refused($q$select public.get_activity_finance_report(null,'2027-03-27')$q$,'22023','null period refused');
select pg_temp.report_refused($q$select public.get_activity_finance_report('2027-03-28','2027-03-27')$q$,'22023','reversed period refused');
select pg_temp.report_refused($q$select public.get_activity_finance_report('2027-03-27','infinity')$q$,'22023','infinite period refused');
select set_config('request.jwt.claim.sub','51470000-0000-0000-0000-000000000011',true);
select pg_temp.report_refused($q$select public.get_activity_finance_report('2027-03-27','2027-03-28')$q$,'42501','player refused');
select set_config('request.jwt.claim.sub','51470000-0000-0000-0000-000000000013',true);
select pg_temp.report_refused($q$select public.get_activity_finance_report('2027-03-27','2027-03-28')$q$,'42501','unapproved manager refused');
select set_config('request.jwt.claim.sub','51470000-0000-0000-0000-000000000012',true);
select pg_temp.report_check((public.get_activity_finance_report('2027-03-27','2027-03-28')->'totals'->>'net_charges_pence')::bigint=0,'other-club manager receives only own report');
select pg_temp.report_check((public.get_activity_finance_report('2027-03-27','2027-03-28')->'receipts'->>'gross_pence')::bigint=99999,'other-club receipts scoped');
reset role;
-- Operational deletion leaves original charge and linked correction identifiable.
delete from public.fixtures where id='51470000-0000-0000-0000-000000000021';
delete from public.training_sessions where id='51470000-0000-0000-0000-000000000022';
select public.anonymise_and_delete_profile('51470000-0000-0000-0000-000000000011','51470000-0000-0000-0000-000000000100');
set local role authenticated;
select set_config('request.jwt.claim.sub','51470000-0000-0000-0000-000000000010',true);
select pg_temp.report_check((public.get_activity_finance_report('2027-03-27','2027-03-28')->'totals'->>'net_charges_pence')::bigint=1100,'deletion preserves net report');
select pg_temp.report_check(public.get_activity_finance_report('2027-03-27','2027-03-28')->'categories'->0->'entries'->0->'activity_snapshot'->>'opponent'='Report opponents','deleted fixture trace retained');
select pg_temp.report_check((public.get_activity_finance_report('2027-03-30','2027-03-30')->'receipts'->>'refunds_pence')::bigint=500,
 'hard player deletion preserves refund correction report');
reset role;
select public.set_club_payments_release('51470000-0000-0000-0000-000000000100',false,false);
set local role authenticated;
select set_config('request.jwt.claim.sub','51470000-0000-0000-0000-000000000010',true);
select pg_temp.report_refused($q$select public.get_activity_finance_report('2027-03-27','2027-03-28')$q$,'42501','disabled report refused');
reset role;
set local role anon;
select pg_temp.report_refused($q$select public.get_activity_finance_report('2027-03-27','2027-03-28')$q$,'42501','anonymous report refused');
reset role;
select 'ALL ACTIVITY FINANCE REPORT TESTS PASSED';
rollback;
