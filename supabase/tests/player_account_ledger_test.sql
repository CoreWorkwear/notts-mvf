-- NOT-30 isolated ledger proof. Run after 0045 + seed; always rolls back.
-- Namespace owner: sprint coordinator. No real users, provider calls or keys.
begin;
create function pg_temp.check_true(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end; $$;
create function pg_temp.refused(statement text,expected text,label text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when others then
  if SQLSTATE=expected then return; end if;
  raise exception 'FAIL: % expected %, got %: %',label,expected,SQLSTATE,SQLERRM;
 end;
 raise exception 'FAIL: % unexpectedly succeeded',label;
end; $$;
grant execute on function pg_temp.check_true(boolean,text),pg_temp.refused(text,text,text) to authenticated,anon,service_role;
insert into public.clubs(id,name,created_at) values('30450000-0000-0000-0000-000000000001','Ledger test other club',now()+interval '1 day');
insert into public.clubs(id,name,created_at) values('30450000-0000-0000-0000-000000000100','Ledger test club',now()+interval '1 day');
insert into public.seasons(id,club_id,label) values('30450000-0000-0000-0000-000000000101','30450000-0000-0000-0000-000000000100','Ledger season');
insert into public.teams(id,club_id,key,label,is_first_team) values('30450000-0000-0000-0000-000000000102','30450000-0000-0000-0000-000000000100','xl','First Team',true);
insert into auth.users(id,email,raw_user_meta_data) values
 ('30450000-0000-0000-0000-000000000010','ledger.manager@example.invalid','{"first_name":"Ledger","last_name":"Manager","phone":"07700900010"}'),
 ('30450000-0000-0000-0000-000000000011','ledger.player@example.invalid','{"first_name":"Ledger","last_name":"Player","phone":"07700900011"}'),
 ('30450000-0000-0000-0000-000000000012','ledger.other@example.invalid','{"first_name":"Other","last_name":"Manager","phone":"07700900012"}'),
 ('30450000-0000-0000-0000-000000000013','ledger.pending@example.invalid','{"first_name":"Pending","last_name":"Player","phone":"07700900013"}'),
 ('30450000-0000-0000-0000-000000000014','ledger.supporter@example.invalid','{"first_name":"Ledger","last_name":"Supporter","phone":"07700900014"}'),
 ('30450000-0000-0000-0000-000000000015','ledger.zero@example.invalid','{"first_name":"Zero","last_name":"Player","phone":"07700900015"}');
update public.profiles set club_id='30450000-0000-0000-0000-000000000100' where id::text like '30450000-%';
update public.profiles set approved=true where id::text like '30450000-%' and id<>'30450000-0000-0000-0000-000000000013';
update public.profiles set role='admin' where id in ('30450000-0000-0000-0000-000000000010','30450000-0000-0000-0000-000000000012');
update public.profiles set club_id='30450000-0000-0000-0000-000000000001' where id='30450000-0000-0000-0000-000000000012';
update public.profiles set is_player=false where id='30450000-0000-0000-0000-000000000014';
insert into public.opponents(id,club_id,name) values('30450000-0000-0000-0000-000000000020','30450000-0000-0000-0000-000000000100','Ledger opponents');
insert into public.fixtures(id,club_id,season_id,team_id,opponent_id,match_date,kickoff,venue) values
 ('30450000-0000-0000-0000-000000000021','30450000-0000-0000-0000-000000000100','30450000-0000-0000-0000-000000000101','30450000-0000-0000-0000-000000000102','30450000-0000-0000-0000-000000000020','2026-11-22','11:00','Test pitch');
insert into public.payments(fixture_id,profile_id,paid) values('30450000-0000-0000-0000-000000000021','30450000-0000-0000-0000-000000000011',true);
select pg_temp.check_true((select count(*)=1 from public.legacy_payment_history where fixture_id='30450000-0000-0000-0000-000000000021' and paid),'pre-cutover tick archived');

set local role authenticated;
select set_config('request.jwt.claim.sub','30450000-0000-0000-0000-000000000010',true);
select pg_temp.check_true((public.payments_release_status()->>'enabled')='false','release defaults off');
select pg_temp.refused($q$select public.get_player_account('30450000-0000-0000-0000-000000000011')$q$,'42501','account off');
select pg_temp.refused($q$select public.record_account_receipt('30450000-0000-0000-0000-000000000030','30450000-0000-0000-0000-000000000011',900,'bank')$q$,'42501','receipt off');
select pg_temp.refused($q$select public.set_club_payments_release('30450000-0000-0000-0000-000000000100',true,true)$q$,'42501','manager cannot enable release');
select pg_temp.refused($q$update public.club_payments_release set enabled=true$q$,'42501','manager cannot update release table');
select pg_temp.refused($q$select public.post_account_entry('{}')$q$,'42501','generic writer private');
reset role;
select public.post_account_entry('{"club_id":"30450000-0000-0000-0000-000000000100","profile_id":"30450000-0000-0000-0000-000000000011","kind":"opening","amount_pence":-900,"source":"opening","source_id":"ledger-opening","description":"Opening arrears"}');
select public.post_account_entry('{"club_id":"30450000-0000-0000-0000-000000000100","profile_id":"30450000-0000-0000-0000-000000000015","kind":"opening","amount_pence":0,"source":"opening","source_id":"ledger-zero","description":"Opening settled"}');
select pg_temp.refused($q$select public.set_club_payments_release('30450000-0000-0000-0000-000000000100',true,false)$q$,'23514','activation requires cutover');
select public.set_club_payments_release('30450000-0000-0000-0000-000000000100',true,true);
select public.post_account_entry('{"club_id":"30450000-0000-0000-0000-000000000100","profile_id":"30450000-0000-0000-0000-000000000011","kind":"charge","amount_pence":-700,"source":"match","source_id":"ledger-match","description":"First Team appearance","category":"first_team","activity_type":"fixture","activity_id":"30450000-0000-0000-0000-000000000021","activity_snapshot":{"date":"2026-11-22","opponent":"Ledger opponents","team":"First Team"}}');
set local role authenticated;
select set_config('request.jwt.claim.sub','30450000-0000-0000-0000-000000000010',true);
select public.record_account_receipt('30450000-0000-0000-0000-000000000030','30450000-0000-0000-0000-000000000011',900,'bank','same bank text','2026-11-24');
select public.record_account_receipt('30450000-0000-0000-0000-000000000030','30450000-0000-0000-0000-000000000011',900,'bank','same bank text','2026-11-24');
select pg_temp.refused($q$select public.record_account_receipt('30450000-0000-0000-0000-000000000030','30450000-0000-0000-0000-000000000011',901,'bank','same bank text','2026-11-24')$q$,'22023','changed request conflicts');
select pg_temp.refused($q$select public.record_account_receipt('30450000-0000-0000-0000-000000000030','30450000-0000-0000-0000-000000000011',900,'cash','same bank text','2026-11-24')$q$,'22023','changed method under same request conflicts');
select public.record_account_receipt('30450000-0000-0000-0000-000000000030','30450000-0000-0000-0000-000000000011',900,'bank','same bank text','2026-11-24');
select pg_temp.refused($q$select public.record_account_receipt('30450000-0000-0000-0000-000000000031','30450000-0000-0000-0000-000000000012',900,'bank')$q$,'42501','cross-club receipt refused');
select pg_temp.refused($q$insert into public.account_entries(account_id) values(gen_random_uuid())$q$,'42501','direct insert refused');
select pg_temp.refused($q$update public.account_entries set amount_pence=1$q$,'42501','direct update refused');
select pg_temp.refused($q$delete from public.account_entries$q$,'42501','direct delete refused');
select pg_temp.refused($q$update public.payments set paid=false where fixture_id='30450000-0000-0000-0000-000000000021'$q$,'42501','old tick retired');
reset role;
select public.post_account_entry('{"club_id":"30450000-0000-0000-0000-000000000100","profile_id":"30450000-0000-0000-0000-000000000011","kind":"receipt","amount_pence":900,"source":"stripe_payment","source_id":"ledger-pi-1","description":"Stripe payment"}');
select public.post_account_entry('{"club_id":"30450000-0000-0000-0000-000000000100","profile_id":"30450000-0000-0000-0000-000000000011","kind":"receipt","amount_pence":900,"source":"stripe_payment","source_id":"ledger-pi-1","description":"Stripe payment"}');
select pg_temp.check_true((select sum(amount_pence)=200 and count(*)=4 from public.account_entries where account_id=(select id from public.player_accounts where profile_id='30450000-0000-0000-0000-000000000011')),'concurrent scenario exact replay yields 2 GBP credit');
set local role authenticated;
select set_config('request.jwt.claim.sub','30450000-0000-0000-0000-000000000011',true);
select pg_temp.check_true((public.get_player_account()->>'balance_pence')::bigint=200,'own balance pence');
select pg_temp.check_true((public.get_player_account()->'entries'->3->>'running_balance_pence')::bigint=200,'running balance');
select pg_temp.check_true((select count(*)=4 from public.account_entries),'own rows only');
select pg_temp.refused($q$select actor_id from public.account_entries$q$,'42501','player actor REST column refused');
select pg_temp.refused($q$select request_payload from public.account_entries$q$,'42501','player internal payload refused');
select pg_temp.check_true(not (public.get_player_account()->'entries'->0 ? 'actor_id'),'player statement hides actor');
select pg_temp.refused($q$select public.get_player_account('30450000-0000-0000-0000-000000000015')$q$,'42501','other player account refused');
select pg_temp.refused($q$select public.record_account_receipt('30450000-0000-0000-0000-000000000035','30450000-0000-0000-0000-000000000011',900,'cash')$q$,'42501','player cannot receipt');
select set_config('request.jwt.claim.sub','30450000-0000-0000-0000-000000000012',true);
select pg_temp.check_true((select count(*)=0 from public.account_entries),'other-club manager sees none');
select pg_temp.refused($q$select public.get_player_account('30450000-0000-0000-0000-000000000011')$q$,'42501','other-club RPC refused');
select set_config('request.jwt.claim.sub','30450000-0000-0000-0000-000000000013',true);
select pg_temp.check_true((select count(*)=0 from public.account_entries),'pending sees none');
select set_config('request.jwt.claim.sub','30450000-0000-0000-0000-000000000014',true);
select pg_temp.refused($q$select public.get_player_account()$q$,'42501','supporter account refused');
reset role;
set local role service_role;
select pg_temp.refused($q$insert into public.account_entries(account_id) values(gen_random_uuid())$q$,'42501','service direct insert refused');
reset role;
select pg_temp.refused($q$select public.post_account_entry('{"club_id":"30450000-0000-0000-0000-000000000100","profile_id":"30450000-0000-0000-0000-000000000011","kind":"adjustment","amount_pence":1,"source":"adjustment","source_id":"infinite-date","description":"Invalid date","occurred_on":"infinity"}')$q$,'23514','infinite date refused');
select pg_temp.refused($q$select public.post_account_entry('{"club_id":"30450000-0000-0000-0000-000000000100","profile_id":"30450000-0000-0000-0000-000000000011","kind":"adjustment","amount_pence":-2147483648,"source":"adjustment","source_id":"irreversible-minimum","description":"Cannot reverse minimum integer"}')$q$,'23514','all signed pence values reversible');
-- Partial refund once; exact duplicate and over-refund proof.
do $$ declare payload jsonb; refund_id uuid; charge_id uuid; reversal jsonb; begin
 select jsonb_build_object('club_id',club_id,'profile_id','30450000-0000-0000-0000-000000000011','kind','refund','amount_pence',-400,'source','stripe_refund','source_id','ledger-re-1','description','Partial refund','linked_entry_id',id) into payload from public.account_entries where source_id='ledger-pi-1';
 refund_id:=public.post_account_entry(payload);
 perform pg_temp.check_true(public.post_account_entry(payload)=refund_id,'refund retry same identity');
 perform pg_temp.refused(format('select public.post_account_entry(%L::jsonb)',payload||jsonb_build_object('kind','reversal','amount_pence',900,'source','reversal','source_id','bad-provider-reversal')),'22023','Stripe receipt cannot be manually reversed');
 perform pg_temp.refused(format('select public.post_account_entry(%L::jsonb)',payload||jsonb_build_object('kind','reversal','amount_pence',400,'source','reversal','source_id','bad-refund-reversal','linked_entry_id',refund_id)),'22023','Stripe refund cannot be manually reversed');
 perform pg_temp.refused(format('select public.post_account_entry(%L::jsonb)',payload||'{"source_id":"ledger-re-too-much","amount_pence":-501}'::jsonb),'22023','refund cap');
 select id into charge_id from public.account_entries where source_id='ledger-match';
 reversal:=jsonb_build_object('club_id','30450000-0000-0000-0000-000000000100','profile_id','30450000-0000-0000-0000-000000000011','kind','reversal','amount_pence',700,'source','reversal','source_id','ledger-reversal','description','Appearance corrected','linked_entry_id',charge_id);
 perform public.post_account_entry(reversal);
 perform public.post_account_entry(reversal);
 perform pg_temp.refused(format('select public.post_account_entry(%L::jsonb)',reversal||'{"source_id":"ledger-second-reversal"}'::jsonb),'23505','only one reversal');
 perform pg_temp.check_true((select category='first_team' and activity_snapshot->>'team'='First Team' from public.account_entries where source_id='ledger-reversal'),'correction preserves category snapshot');
end; $$;
-- Equal genuine receipts share human reference text and still both post.
set local role authenticated;
select set_config('request.jwt.claim.sub','30450000-0000-0000-0000-000000000010',true);
select public.record_account_receipt('30450000-0000-0000-0000-000000000036','30450000-0000-0000-0000-000000000011',900,'bank','same bank text','2026-11-24');
select pg_temp.check_true((public.get_player_account('30450000-0000-0000-0000-000000000011')->>'balance_pence')::bigint=1400,'second genuine equal receipt retained');
reset role;
select pg_temp.refused($q$update public.account_entries set description='tampered' where source_id='ledger-match'$q$,'42501','owner mutation rejected');
select pg_temp.refused($q$select public.post_account_entry('{"club_id":"30450000-0000-0000-0000-000000000100","profile_id":"30450000-0000-0000-0000-000000000011","kind":"receipt","amount_pence":900,"source":"payout","source_id":"ledger-payout","description":"Payout"}')$q$,'22023','payout creates no player credit');
select public.set_club_payments_release('30450000-0000-0000-0000-000000000100',false,false);
set local role authenticated;
select set_config('request.jwt.claim.sub','30450000-0000-0000-0000-000000000010',true);
select pg_temp.refused($q$select public.get_player_account('30450000-0000-0000-0000-000000000011')$q$,'42501','disabled account inaccessible');
select pg_temp.refused($q$select public.record_account_receipt('30450000-0000-0000-0000-000000000037','30450000-0000-0000-0000-000000000011',900,'bank')$q$,'42501','disabled receipt refused');
select pg_temp.refused($q$update public.payments set paid=false where fixture_id='30450000-0000-0000-0000-000000000021'$q$,'42501','disable does not restore paid toggle');
reset role;
select public.post_account_entry('{"club_id":"30450000-0000-0000-0000-000000000100","profile_id":"30450000-0000-0000-0000-000000000011","kind":"receipt","amount_pence":100,"source":"stripe_payment","source_id":"ledger-late-payment","description":"Late verified settlement"}');
select public.post_account_entry(jsonb_build_object('club_id','30450000-0000-0000-0000-000000000100','profile_id','30450000-0000-0000-0000-000000000011','kind','refund','amount_pence',-100,'source','stripe_refund','source_id','ledger-late-refund','description','Late verified refund','linked_entry_id',(select id from public.account_entries where source_id='ledger-late-payment')));
-- Financial records survive operational cascade and the actual deletion RPC.
delete from public.fixtures where id='30450000-0000-0000-0000-000000000021';
select public.anonymise_and_delete_profile('30450000-0000-0000-0000-000000000011','30450000-0000-0000-0000-000000000100');
select pg_temp.check_true((select activity_snapshot->>'opponent'='Ledger opponents' from public.account_entries where source_id='ledger-match'),'fixture history survives delete');
select pg_temp.check_true((select player_name='Ledger Player' from public.player_accounts where profile_id='30450000-0000-0000-0000-000000000011'),'account survives hard removal');
select pg_temp.check_true((select count(*)>=2 from public.legacy_payment_history where fixture_id='30450000-0000-0000-0000-000000000021' and paid),'legacy ticks survive fixture cascade');
select public.set_club_payments_release('30450000-0000-0000-0000-000000000100',true,false);
set local role authenticated;
select set_config('request.jwt.claim.sub','30450000-0000-0000-0000-000000000010',true);
select pg_temp.check_true((public.get_player_account('30450000-0000-0000-0000-000000000011')->>'balance_pence')::bigint=1400,'manager reads removed player history');
select pg_temp.check_true((public.get_player_account('30450000-0000-0000-0000-000000000015')->>'balance_pence')::bigint=0,'settled account');
reset role;
set local role anon;
select pg_temp.refused($q$select public.get_player_account('30450000-0000-0000-0000-000000000011')$q$,'42501','anonymous statement denied');
select pg_temp.refused($q$select public.post_account_entry('{}')$q$,'42501','anonymous writer denied');
reset role;
select 'ALL PLAYER ACCOUNT LEDGER TESTS PASSED';
rollback;
