-- NOT-41 synthetic rollback proof. Ledger worker owns the 41570000 namespace.
begin;
create function pg_temp.payout_check(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end; $$;
create function pg_temp.payout_refused(statement text,expected text,label text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when others then
  if SQLSTATE=expected then return; end if;
  raise exception 'FAIL: % expected %, got %: %',label,expected,SQLSTATE,SQLERRM;
 end;
 raise exception 'FAIL: % unexpectedly succeeded',label;
end; $$;
grant execute on function pg_temp.payout_check(boolean,text),pg_temp.payout_refused(text,text,text) to authenticated,anon,service_role;
insert into public.clubs(id,name,created_at) values
 ('41570000-0000-0000-0000-000000000100','Payout test club',now()+interval '1 day'),
 ('41570000-0000-0000-0000-000000000101','Other payout club',now()+interval '1 day');
insert into auth.users(id,email,raw_user_meta_data) values
 ('41570000-0000-0000-0000-000000000010','payout.manager@example.invalid','{"first_name":"Payout","last_name":"Manager","phone":"07700900810"}'),
 ('41570000-0000-0000-0000-000000000011','payout.player@example.invalid','{"first_name":"Payout","last_name":"Player","phone":"07700900811"}'),
 ('41570000-0000-0000-0000-000000000012','payout.other@example.invalid','{"first_name":"Other","last_name":"Manager","phone":"07700900812"}'),
 ('41570000-0000-0000-0000-000000000013','payout.pending@example.invalid','{"first_name":"Pending","last_name":"Manager","phone":"07700900813"}');
update public.profiles set club_id='41570000-0000-0000-0000-000000000100',approved=true where id::text like '41570000-%';
update public.profiles set role='admin' where id in('41570000-0000-0000-0000-000000000010','41570000-0000-0000-0000-000000000012','41570000-0000-0000-0000-000000000013');
update public.profiles set club_id='41570000-0000-0000-0000-000000000101' where id='41570000-0000-0000-0000-000000000012';
update public.profiles set approved=false where id='41570000-0000-0000-0000-000000000013';
insert into public.club_stripe_connections(club_id,platform_account_id,livemode,stripe_account_id) values
 ('41570000-0000-0000-0000-000000000100','acct_payoutPlatform',false,'acct_payoutClub'),
 ('41570000-0000-0000-0000-000000000101','acct_payoutPlatform',false,'acct_payoutOther'),
 ('41570000-0000-0000-0000-000000000100','acct_payoutPlatform',true,'acct_payoutLive');
select public.set_club_payments_release('41570000-0000-0000-0000-000000000100',true,true);
select public.set_club_payments_release('41570000-0000-0000-0000-000000000101',true,true);
create function pg_temp.payout_payment(n integer,pi text,amount integer) returns void language plpgsql as $$
declare a uuid:=('41570000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid; r jsonb; row public.stripe_checkout_attempts; begin
 r:=public.reserve_stripe_checkout(a,'41570000-0000-0000-0000-000000000100','41570000-0000-0000-0000-000000000011','acct_payoutPlatform',false,'top_up',amount,'https://club.example/you','https://club.example/you');
 perform public.bind_stripe_player_customer((r#>>'{customer,creation_id}')::uuid,'cus_payoutPlayer');
 perform public.bind_stripe_checkout_session(a,'cus_payoutPlayer','cs_payout_'||n,'https://checkout.stripe.com/c/pay/synthetic');
 select * into row from public.stripe_checkout_attempts where id=a;
 perform public.process_stripe_settlement_event('acct_payoutPlatform',jsonb_build_object('id','evt_payoutPayment'||n,'type','payment_intent.succeeded','account','acct_payoutClub','livemode',false,'created',extract(epoch from now())::bigint,
 'data',jsonb_build_object('object',jsonb_build_object('id',pi,'object','payment_intent','livemode',false,'amount',amount,'amount_received',amount,'currency','gbp','status','succeeded','customer','cus_payoutPlayer',
 'metadata',jsonb_build_object('club_id',row.club_id,'profile_id',row.profile_id,'player_account_id',row.player_account_id,'attempt_id',row.id,'platform_account_id',row.platform_account_id,'provider_mode','test')))));
end; $$;
select pg_temp.payout_payment(21,'pi_payoutOne',900);
select public.process_stripe_settlement_event('acct_payoutPlatform','{"id":"evt_payoutRefund","type":"refund.created","account":"acct_payoutClub","livemode":false,"created":1796083200,"data":{"object":{"id":"re_payoutOne","object":"refund","livemode":false,"payment_intent":"pi_payoutOne","amount":200,"currency":"gbp","status":"succeeded"}}}');
select set_config('request.jwt.claim.sub','41570000-0000-0000-0000-000000000010',true);
select public.record_account_receipt('41570000-0000-0000-0000-000000000020','41570000-0000-0000-0000-000000000011',500,'cash','Separate cash');
create function pg_temp.payout_object(pid text,amount bigint,state text default 'paid',automatic boolean default true) returns jsonb language sql as $$
 select jsonb_build_object('id',pid,'object','payout','livemode',false,'amount',amount,'currency','gbp','arrival_date',1796169600,'created',1796083200,'status',state,'automatic',automatic,'reconciliation_status',case when automatic then 'completed' else 'not_applicable' end);
$$;
create function pg_temp.payout_event(eid text,obj jsonb,account text default 'acct_payoutClub',live boolean default false,created bigint default 1796083200) returns jsonb language sql as $$
 select jsonb_build_object('id',eid,'type','payout.'||(obj->>'status'),'account',account,'livemode',live,'created',created,'data',jsonb_build_object('object',obj));
$$;
create function pg_temp.payout_lines() returns jsonb language sql as $$
 select '[{"balance_transaction_id":"txn_payoutCharge","created":1796083200,"type":"charge","reporting_category":"charge","currency":"gbp","source_id":"ch_payoutOne","payment_intent_id":"pi_payoutOne","amount_pence":900,"fee_pence":30,"net_pence":870},
 {"balance_transaction_id":"txn_payoutRefund","created":1796083201,"type":"refund","currency":"gbp","source_id":"re_payoutOne","refund_id":"re_payoutOne","payment_intent_id":"pi_payoutOne","amount_pence":-200,"fee_pence":0,"net_pence":-200},
 {"balance_transaction_id":"txn_payoutFee","created":1796083202,"type":"stripe_fee","currency":"gbp","source_id":null,"amount_pence":-10,"fee_pence":0,"net_pence":-10}]'::jsonb;
$$;
create function pg_temp.payout_save(obj jsonb,lines jsonb,complete boolean default true) returns uuid language sql as $$
 select public.save_stripe_payout_breakdown('41570000-0000-0000-0000-000000000010','41570000-0000-0000-0000-000000000100','acct_payoutPlatform',false,obj,lines,complete,'{}');
$$;
create function pg_temp.payout_report(pid text default null,live boolean default false) returns jsonb language sql as $$
 select public.get_stripe_payout_report('acct_payoutPlatform',live,'2026-12-01','2026-12-31',pid);
$$;
grant execute on function pg_temp.payout_report(text,boolean) to authenticated;
select public.record_stripe_payout_event('acct_payoutPlatform',pg_temp.payout_event('evt_payoutPaid',pg_temp.payout_object('po_one',660)));
set local role authenticated;
select pg_temp.payout_check(not(pg_temp.payout_report('po_one')->'payouts'->0->'breakdown'->>'reconciled')::boolean,'paid event alone is not a complete breakdown');
select pg_temp.payout_check((public.get_stripe_payout_report('acct_missing',false,'2026-12-01','2026-12-31')->>'connected')::boolean=false and public.get_stripe_payout_report('acct_missing',false,'2026-12-01','2026-12-31')->'payouts'='[]'::jsonb,'not-connected list is explicitly empty');
reset role;
select pg_temp.payout_save(pg_temp.payout_object('po_one',660),pg_temp.payout_lines());
set local role authenticated;
do $$ declare r jsonb:=pg_temp.payout_report('po_one')->'payouts'->0; b jsonb; begin
 b:=r->'breakdown';
 perform pg_temp.payout_check((b->>'reconciled')::boolean and (b->>'difference_pence')::bigint=0,'automatic paid payout reconciles exactly');
 perform pg_temp.payout_check((b->>'gross_pence')::bigint=900 and (b->>'refunds_pence')::bigint=200 and (b->>'fees_pence')::bigint=40 and (b->>'net_pence')::bigint=660,'gross refund embedded and separate fee totals');
 perform pg_temp.payout_check(jsonb_array_length(r->'lines')=3 and r->>'arrival_on'='2026-12-02' and r->>'created_on'='2026-12-01' and r->>'paid_on'='2026-12-01','provider lifecycle and itemised dates');
 perform pg_temp.payout_check(r->'lines'->0->>'player_name'='Payout Player' and r->'lines'->0->>'receipt_reference'='pi_payoutOne' and r->'lines'->1->>'refund_id'='re_payoutOne','payment refund receipt and player linkage');
 perform pg_temp.payout_check((select count(*)=3 from public.account_entries),'payout creates no further player receipt or expense');
end; $$;
reset role;
select public.record_stripe_payout_event('acct_payoutPlatform',pg_temp.payout_event('evt_payoutPaid',pg_temp.payout_object('po_one',660)));
select pg_temp.payout_refused(format('select public.record_stripe_payout_event(%L,%L::jsonb)','acct_payoutPlatform',pg_temp.payout_event('evt_payoutPaid',pg_temp.payout_object('po_one',661))),'22023','changed event replay refused');
select pg_temp.payout_save(pg_temp.payout_object('po_gap',700),pg_temp.payout_lines());
select pg_temp.payout_save(pg_temp.payout_object('po_unknown',665),pg_temp.payout_lines()||'[{"balance_transaction_id":"txn_unknown","created":1796083203,"type":"adjustment","currency":"gbp","amount_pence":5,"fee_pence":0,"net_pence":5}]');
select pg_temp.payout_save(pg_temp.payout_object('po_foreign',660),pg_temp.payout_lines()||'[{"balance_transaction_id":"txn_foreign","created":1796083203,"type":"charge","currency":"eur","amount_pence":100,"fee_pence":0,"net_pence":100}]');
select pg_temp.payout_save(pg_temp.payout_object('po_manual',660,'paid',false),'[]',false);
select pg_temp.payout_save(pg_temp.payout_object('po_pending',660,'pending'),pg_temp.payout_lines(),false);
select pg_temp.payout_save(pg_temp.payout_object('po_badnet',660),jsonb_set(pg_temp.payout_lines(),'{0,net_pence}','869'));
select pg_temp.payout_refused(format('select pg_temp.payout_save(%L::jsonb,%L::jsonb)',pg_temp.payout_object('po_duplicate',660),pg_temp.payout_lines()||pg_temp.payout_lines()),'22023','duplicate balance rows refused');
set local role authenticated;
select pg_temp.payout_check((pg_temp.payout_report('po_gap')->'payouts'->0->'breakdown'->>'difference_pence')::bigint=40 and not(pg_temp.payout_report('po_gap')->'payouts'->0->'breakdown'->>'reconciled')::boolean,'difference remains visible');
select pg_temp.payout_check((pg_temp.payout_report('po_unknown')->'payouts'->0->'breakdown'->>'difference_pence')::bigint=0 and not(pg_temp.payout_report('po_unknown')->'payouts'->0->'breakdown'->>'reconciled')::boolean,'unknown movement unreconciled even at exact total');
select pg_temp.payout_check((pg_temp.payout_report('po_foreign')->'payouts'->0->'breakdown'->>'net_pence')::bigint=660 and (pg_temp.payout_report('po_foreign')->'payouts'->0->'breakdown'->>'unresolved_count')::integer=1,'foreign currency itemised but never added to GBP');
select pg_temp.payout_check(not(pg_temp.payout_report('po_manual')->'payouts'->0->'breakdown'->>'reconciled')::boolean and not(pg_temp.payout_report('po_pending')->'payouts'->0->'breakdown'->>'reconciled')::boolean,'manual or incomplete pending payout not falsely reconciled');
select pg_temp.payout_check((pg_temp.payout_report('po_badnet')->'payouts'->0->'breakdown'->>'unresolved_count')::integer=1,'provider amount fee net inconsistency remains visible');
reset role;
-- Missing settlement may arrive later. Linking resolves from immutable provider
-- facts without rewriting the snapshot or creating a second player receipt.
select pg_temp.payout_save(pg_temp.payout_object('po_unlinked',100),'[{"balance_transaction_id":"txn_late","created":1796083200,"type":"charge","currency":"gbp","source_id":"ch_late","payment_intent_id":"pi_late","amount_pence":100,"fee_pence":0,"net_pence":100}]');
set local role authenticated;
select pg_temp.payout_check(not(pg_temp.payout_report('po_unlinked')->'payouts'->0->'breakdown'->>'reconciled')::boolean,'unsettled receipt visibly unresolved');
reset role;
select pg_temp.payout_payment(22,'pi_late',100);
set local role authenticated;
select pg_temp.payout_check((pg_temp.payout_report('po_unlinked')->'payouts'->0->'breakdown'->>'reconciled')::boolean,'later original settlement resolves source dynamically');
reset role;
select public.anonymise_and_delete_profile('41570000-0000-0000-0000-000000000011','41570000-0000-0000-0000-000000000100');
select public.record_stripe_payout_event('acct_payoutPlatform',pg_temp.payout_event('evt_payoutFailed',pg_temp.payout_object('po_one',660,'failed'),'acct_payoutClub',false,1796083201));
select public.record_stripe_payout_event('acct_payoutPlatform',pg_temp.payout_event('evt_oldPaid',pg_temp.payout_object('po_one',660),'acct_payoutClub',false,1796083100));
select pg_temp.payout_save(pg_temp.payout_object('po_one',660),pg_temp.payout_lines());
set local role authenticated;
select pg_temp.payout_check(pg_temp.payout_report('po_one')->'payouts'->0->>'status'='failed' and not(pg_temp.payout_report('po_one')->'payouts'->0->'breakdown'->>'reconciled')::boolean,'failed remains failed despite old paid event and stale paid refresh');
select pg_temp.payout_check(pg_temp.payout_report('po_one')->'payouts'->0->>'failed_on'='2026-12-01' and pg_temp.payout_report('po_one')->'payouts'->0->'lines'->0->>'player_name'='Payout Player','failed date and removed player trace retained');
select pg_temp.payout_check((select count(*)=4 from public.account_entries),'all payout facts and refreshes left player ledger untouched');
reset role;
select public.record_stripe_payout_event('acct_payoutPlatform',pg_temp.payout_event('evt_otherPayout',pg_temp.payout_object('po_other',660),'acct_payoutOther'));
select public.record_stripe_payout_event('acct_payoutPlatform',pg_temp.payout_event('evt_livePayout',jsonb_set(pg_temp.payout_object('po_live',660),'{livemode}','true'),'acct_payoutLive',true));
set local role authenticated;
select pg_temp.payout_refused($q$select pg_temp.payout_report('po_other')$q$,'42501','foreign payout detail refused');
select pg_temp.payout_check(jsonb_array_length(pg_temp.payout_report(null,true)->'payouts')=1 and pg_temp.payout_report(null,true)->'payouts'->0->>'payout_id'='po_live','test live report scope separate');
select pg_temp.payout_refused($q$select public.record_stripe_payout_event('acct_payoutPlatform','{}')$q$,'42501','browser cannot forge payout facts');
select pg_temp.payout_refused($q$select * from public.stripe_payout_breakdowns$q$,'42501','raw provider snapshots private');
select set_config('request.jwt.claim.sub','41570000-0000-0000-0000-000000000011',true);
select pg_temp.payout_refused($q$select pg_temp.payout_report()$q$,'42501','removed player cannot report');
select set_config('request.jwt.claim.sub','41570000-0000-0000-0000-000000000012',true);
select pg_temp.payout_refused($q$select pg_temp.payout_report('po_one')$q$,'42501','other club manager cannot request our payout');
select set_config('request.jwt.claim.sub','41570000-0000-0000-0000-000000000013',true);
select pg_temp.payout_refused($q$select pg_temp.payout_report()$q$,'42501','unapproved manager refused');
reset role;
select public.set_club_payments_release('41570000-0000-0000-0000-000000000100',false,false);
select public.record_stripe_payout_event('acct_payoutPlatform',pg_temp.payout_event('evt_pausedFailure',pg_temp.payout_object('po_paused',50,'failed')));
set local role authenticated;
select set_config('request.jwt.claim.sub','41570000-0000-0000-0000-000000000010',true);
select pg_temp.payout_refused($q$select pg_temp.payout_report()$q$,'42501','pause gates manager report');
reset role;
select pg_temp.payout_refused(format('select pg_temp.payout_save(%L::jsonb,%L::jsonb)',pg_temp.payout_object('po_paused',50,'failed'),'[]'),'42501','pause gates refresh save');
select pg_temp.payout_check(exists(select 1 from public.stripe_payouts where payout_id='po_paused' and status='failed'),'pause does not suppress signed lifecycle facts');
set local role service_role;
select pg_temp.payout_refused($q$insert into public.stripe_payouts(club_id) values(gen_random_uuid())$q$,'42501','direct service fact mutation refused');
reset role;
set local role anon;
select pg_temp.payout_refused($q$select public.get_stripe_payout_report('acct_payoutPlatform',false,'2026-12-01','2026-12-31')$q$,'42501','anonymous payout report refused');
reset role;
select 'ALL STRIPE PAYOUT RECONCILIATION TESTS PASSED';
rollback;
