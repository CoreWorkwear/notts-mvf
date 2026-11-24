-- NOT-35 isolated, synthetic rollback proof. No provider calls or real keys.
begin;
create function pg_temp.settlement_check(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end; $$;
create function pg_temp.settlement_refused(statement text,expected text,label text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when others then
  if SQLSTATE=expected then return; end if;
  raise exception 'FAIL: % expected %, got %: %',label,expected,SQLSTATE,SQLERRM;
 end;
 raise exception 'FAIL: % unexpectedly succeeded',label;
end; $$;
grant execute on function pg_temp.settlement_check(boolean,text),pg_temp.settlement_refused(text,text,text) to authenticated,anon,service_role;
insert into public.clubs(id,name,created_at) values('35540000-0000-0000-0000-000000000100','Settlement test club',now()+interval '1 day');
insert into public.seasons(id,club_id,label) values('35540000-0000-0000-0000-000000000101','35540000-0000-0000-0000-000000000100','Settlement season');
insert into public.teams(id,club_id,key,label,is_first_team) values('35540000-0000-0000-0000-000000000102','35540000-0000-0000-0000-000000000100','xl','First Team',true);
insert into public.opponents(id,club_id,name) values('35540000-0000-0000-0000-000000000103','35540000-0000-0000-0000-000000000100','Settlement opponents');
insert into public.fixtures(id,club_id,season_id,team_id,opponent_id,match_date,kickoff,venue) values
 ('35540000-0000-0000-0000-000000000104','35540000-0000-0000-0000-000000000100','35540000-0000-0000-0000-000000000101','35540000-0000-0000-0000-000000000102','35540000-0000-0000-0000-000000000103','2026-11-01','11:00','Settlement pitch');
insert into auth.users(id,email,raw_user_meta_data) values
 ('35540000-0000-0000-0000-000000000010','settlement.manager@example.invalid','{"first_name":"Settlement","last_name":"Manager","phone":"07700900710"}'),
 ('35540000-0000-0000-0000-000000000011','settlement.one@example.invalid','{"first_name":"First","last_name":"Player","phone":"07700900711"}'),
 ('35540000-0000-0000-0000-000000000012','settlement.two@example.invalid','{"first_name":"Second","last_name":"Player","phone":"07700900712"}');
update public.profiles set club_id='35540000-0000-0000-0000-000000000100',approved=true where id::text like '35540000-%';
update public.profiles set role='admin' where id='35540000-0000-0000-0000-000000000010';
insert into public.club_stripe_connections(club_id,platform_account_id,livemode,stripe_account_id,charges_enabled,payouts_enabled)
 values('35540000-0000-0000-0000-000000000100','acct_settlementPlatform',false,'acct_settlementClub',true,true);
select public.set_club_payments_release('35540000-0000-0000-0000-000000000100',true,true);
select public.post_account_entry('{"club_id":"35540000-0000-0000-0000-000000000100","profile_id":"35540000-0000-0000-0000-000000000011","kind":"opening","amount_pence":-900,"source":"opening","source_id":"settlement-opening","description":"Opening balance"}');
select public.post_account_entry('{"club_id":"35540000-0000-0000-0000-000000000100","profile_id":"35540000-0000-0000-0000-000000000011","kind":"charge","amount_pence":-700,"source":"match","source_id":"settlement-match","description":"Match appearance","category":"first_team","activity_type":"fixture","activity_id":"35540000-0000-0000-0000-000000000104","activity_snapshot":{"date":"2026-11-01","team":"First Team"}}');
select set_config('request.jwt.claim.sub','35540000-0000-0000-0000-000000000010',true);
select public.record_account_receipt('35540000-0000-0000-0000-000000000020','35540000-0000-0000-0000-000000000011',900,'bank','Genuine bank receipt');
create function pg_temp.reserve_settlement_attempt(n integer,player uuid) returns void language plpgsql as $$
declare attempt uuid:=('35540000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid; reservation jsonb; customer text; begin
 reservation:=public.reserve_stripe_checkout(attempt,'35540000-0000-0000-0000-000000000100',player,'acct_settlementPlatform',false,'top_up',900,'https://club.example/you','https://club.example/you');
 customer:=case when player='35540000-0000-0000-0000-000000000011' then 'cus_settlementOne' else 'cus_settlementTwo' end;
 perform public.bind_stripe_player_customer((reservation#>>'{customer,creation_id}')::uuid,customer);
 perform public.bind_stripe_checkout_session(attempt,customer,'cs_settlement_'||n,'https://checkout.stripe.com/c/pay/synthetic');
end; $$;
select pg_temp.reserve_settlement_attempt(21,'35540000-0000-0000-0000-000000000011');
select pg_temp.reserve_settlement_attempt(22,'35540000-0000-0000-0000-000000000012');
select pg_temp.reserve_settlement_attempt(23,'35540000-0000-0000-0000-000000000011');
select pg_temp.reserve_settlement_attempt(24,'35540000-0000-0000-0000-000000000012');
create function pg_temp.payment_event(eid text,etype text,n integer,pi text) returns jsonb language sql as $$
 select jsonb_build_object('id',eid,'type',etype,'account',a.stripe_account_id,'livemode',a.livemode,'created',extract(epoch from now())::bigint,
 'data',jsonb_build_object('object',case when etype like 'checkout.session.%' then jsonb_build_object('id',a.checkout_session_id,'object','checkout.session','mode','payment','payment_intent',pi,
 'amount_total',a.amount_pence,'payment_status',case when etype in ('checkout.session.completed','checkout.session.async_payment_succeeded') then 'paid' else 'unpaid' end)
 else jsonb_build_object('id',pi,'object','payment_intent','amount',a.amount_pence,'amount_received',case when etype='payment_intent.succeeded' then a.amount_pence else 0 end,
 'status',case when etype='payment_intent.succeeded' then 'succeeded' when etype='payment_intent.processing' then 'processing' else 'requires_payment_method' end) end
 ||jsonb_build_object('livemode',a.livemode,'customer',a.stripe_customer_id,'currency',a.currency,'metadata',jsonb_build_object('club_id',a.club_id,'profile_id',a.profile_id,
 'player_account_id',a.player_account_id,'attempt_id',a.id,'platform_account_id',a.platform_account_id,'provider_mode',case when a.livemode then 'live' else 'test' end))))
 from public.stripe_checkout_attempts a where a.id=('35540000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.refund_event(eid text,rid text,pi text,amount integer,state text,etype text default 'refund.created') returns jsonb language sql as $$
 select jsonb_build_object('id',eid,'type',etype,'account','acct_settlementClub','livemode',false,'created',extract(epoch from now())::bigint,
 'data',jsonb_build_object('object',jsonb_build_object('id',rid,'object','refund','payment_intent',pi,'currency','gbp','amount',amount,'status',state)));
$$;
create function pg_temp.player_pence(player uuid) returns bigint language sql as $$
 select coalesce(sum(e.amount_pence::bigint),0) from public.account_entries e join public.player_accounts a on a.id=e.account_id where a.club_id='35540000-0000-0000-0000-000000000100' and a.profile_id=player;
$$;
-- Real provider settlement must survive a pause and player hard removal.
select public.set_club_payments_release('35540000-0000-0000-0000-000000000100',false,false);
select public.anonymise_and_delete_profile('35540000-0000-0000-0000-000000000012','35540000-0000-0000-0000-000000000100');
do $$ declare event jsonb; k text; before_count bigint; begin
 event:=pg_temp.payment_event('evt_primary','payment_intent.succeeded',21,'pi_primary');
 foreach k in array array['club_id','profile_id','player_account_id','platform_account_id','provider_mode'] loop
  perform pg_temp.settlement_refused(format('select public.process_stripe_settlement_event(%L,%L::jsonb)','acct_settlementPlatform',jsonb_set(event,array['data','object','metadata',k],'"wrong"'::jsonb)),'22023','metadata mismatch '||k);
 end loop;
 perform pg_temp.settlement_refused(format('select public.process_stripe_settlement_event(%L,%L::jsonb)','acct_settlementPlatform',jsonb_set(event,'{data,object,metadata,attempt_id}','"35540000-0000-0000-0000-000000000099"')),'P0002','unknown app attempt retries');
 perform pg_temp.settlement_refused(format('select public.process_stripe_settlement_event(%L,%L::jsonb)','acct_wrongPlatform',event),'22023','platform mismatch');
 perform pg_temp.settlement_refused(format('select public.process_stripe_settlement_event(%L,%L::jsonb)','acct_settlementPlatform',jsonb_set(event,'{account}','"acct_wrongClub"')),'22023','connected account mismatch');
 perform pg_temp.settlement_refused(format('select public.process_stripe_settlement_event(%L,%L::jsonb)','acct_settlementPlatform',jsonb_set(jsonb_set(event,'{livemode}','true'),'{data,object,livemode}','true')),'22023','test live mismatch');
 foreach k in array array['currency','customer','amount','amount_received'] loop
  perform pg_temp.settlement_refused(format('select public.process_stripe_settlement_event(%L,%L::jsonb)','acct_settlementPlatform',jsonb_set(event,array['data','object',k],case when k in ('amount','amount_received') then '901'::jsonb else '"wrong"'::jsonb end)),'22023','financial mismatch '||k);
 end loop;
 perform pg_temp.settlement_check(public.process_stripe_settlement_event('acct_settlementPlatform',jsonb_set(event,'{data,object,metadata}','{}'))->>'outcome'='ignored','unrelated PI without app metadata ignored');
 perform pg_temp.settlement_check(public.process_stripe_settlement_event('acct_settlementPlatform',jsonb_set(event,'{type}','"payout.paid"'))->>'outcome'='ignored','payout never posts player receipt');
 perform public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.payment_event('evt_pending','payment_intent.processing',21,'pi_primary'));
 perform public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.payment_event('evt_failed','payment_intent.payment_failed',21,'pi_primary'));
 perform public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.payment_event('evt_expired','checkout.session.expired',21,'pi_primary'));
 perform pg_temp.settlement_check(pg_temp.player_pence('35540000-0000-0000-0000-000000000011')=-700,'pending failed expired do not change balance');
 perform public.process_stripe_settlement_event('acct_settlementPlatform',event);
 perform public.process_stripe_settlement_event('acct_settlementPlatform',event);
 perform public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.payment_event('evt_session','checkout.session.completed',21,'pi_primary'));
 perform public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.payment_event('evt_async','checkout.session.async_payment_succeeded',21,'pi_primary'));
 perform public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.payment_event('evt_latefailure','payment_intent.payment_failed',21,'pi_primary'));
 perform public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.payment_event('evt_lateexpiry','checkout.session.expired',21,'pi_primary'));
 perform pg_temp.settlement_check(pg_temp.player_pence('35540000-0000-0000-0000-000000000011')=200,'9 arrears 7 match 9 bank 9 Stripe leaves 2 credit');
 perform pg_temp.settlement_check((select count(*)=1 and sum(amount_pence)=900 from public.account_entries where club_id='35540000-0000-0000-0000-000000000100' and source='stripe_payment'),'PI session and async success share one gross receipt');
 perform pg_temp.settlement_check((select status='succeeded' and receipt_entry_id is not null from public.stripe_checkout_attempts where id='35540000-0000-0000-0000-000000000021'),'late failures cannot downgrade success');
 perform pg_temp.settlement_refused(format('select public.process_stripe_settlement_event(%L,%L::jsonb)','acct_settlementPlatform',jsonb_set(event,'{data,object,amount}','901')),'22023','same event ID changed payload conflict');
end; $$;
-- Refund arrives before binding, then before original success: neither failure
-- may record completion; the identical event must succeed on a later retry.
do $$ declare event jsonb:=pg_temp.refund_event('evt_refundEarly','re_partialOne','pi_second',250,'succeeded'); correction jsonb; failure_event jsonb; before_count bigint; begin
 perform pg_temp.settlement_check(not ((event#>'{data,object}') ? 'livemode'),'real Stripe refund fixture has no object livemode');
 perform pg_temp.settlement_refused(format('select public.process_stripe_settlement_event(%L,%L::jsonb)','acct_settlementPlatform',jsonb_set(event,'{data,object,livemode}','true')),'22023','contradictory explicit refund mode refused');
 perform pg_temp.settlement_refused(format('select public.process_stripe_settlement_event(%L,%L::jsonb)','acct_settlementPlatform',jsonb_set(event,'{data,object,livemode}','null')),'22023','invalid explicit refund mode refused');
 perform pg_temp.settlement_refused(format('select public.process_stripe_settlement_event(%L,%L::jsonb)','acct_settlementPlatform',event),'P0002','refund before PI binding retries');
 perform public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.payment_event('evt_secondPending','payment_intent.processing',22,'pi_second'));
 perform pg_temp.settlement_refused(format('select public.process_stripe_settlement_event(%L,%L::jsonb)','acct_settlementPlatform',event),'P0002','refund before original success retries');
 perform pg_temp.settlement_check(not exists(select 1 from public.stripe_settlement_events where event_id='evt_refundEarly'),'unresolved refund not acknowledged complete');
 perform public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.payment_event('evt_secondSuccess','payment_intent.succeeded',22,'pi_second'));
 perform public.process_stripe_settlement_event('acct_settlementPlatform',event);
 perform public.process_stripe_settlement_event('acct_settlementPlatform',event);
 perform public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.refund_event('evt_partialDuplicate','re_partialOne','pi_second',250,'succeeded','refund.updated'));
 perform public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.refund_event('evt_pendingRefund','re_partialTwo','pi_second',650,'pending'));
 perform pg_temp.settlement_check(pg_temp.player_pence('35540000-0000-0000-0000-000000000012')=650,'pending refund changes nothing');
 perform public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.refund_event('evt_fullRefund','re_partialTwo','pi_second',650,'succeeded','refund.updated'));
 perform pg_temp.settlement_check(pg_temp.player_pence('35540000-0000-0000-0000-000000000012')=0,'separate partial refunds debit once to full amount');
 perform pg_temp.settlement_check((select count(*)=2 and sum(amount_pence)=900 from public.stripe_settled_refunds where club_id='35540000-0000-0000-0000-000000000100'),'two refund references retained');
 perform pg_temp.settlement_check((select bool_and(e.linked_entry_id=p.receipt_entry_id) from public.stripe_settled_refunds r join public.account_entries e on e.id=r.refund_entry_id join public.stripe_settled_payments p on p.payment_intent_id=r.payment_intent_id and p.platform_account_id=r.platform_account_id where r.club_id='35540000-0000-0000-0000-000000000100'),'refund entries link original receipt');
 perform pg_temp.settlement_refused(format('select public.process_stripe_settlement_event(%L,%L::jsonb)','acct_settlementPlatform',pg_temp.refund_event('evt_overRefund','re_over','pi_second',1,'succeeded')),'22023','over refund refused atomically');
 perform pg_temp.settlement_check(not exists(select 1 from public.stripe_settlement_events where event_id='evt_overRefund'),'failed over-refund has no completion receipt');
 -- Stripe can first report succeeded, then fail the bank/card refund. Preserve
 -- the debit and restore it once; a stale success can never charge it again.
 -- Reproduce the prior implementation's durable, incorrect acknowledgement
 -- so replay proves repair without rewriting immutable historical completion.
 failure_event:=pg_temp.refund_event('evt_failedAfterRefund','re_partialTwo','pi_second',650,'failed','refund.failed');
 insert into public.stripe_settlement_events(platform_account_id,livemode,event_id,stripe_account_id,club_id,payload,result)
 values('acct_settlementPlatform',false,'evt_failedAfterRefund','acct_settlementClub','35540000-0000-0000-0000-000000000100',
  jsonb_build_object('type',failure_event->>'type','account',failure_event->>'account','livemode',false,'object',failure_event#>'{data,object}'),
  jsonb_build_object('event_id','evt_failedAfterRefund','outcome','refunded'));
 correction:=public.process_stripe_settlement_event('acct_settlementPlatform',failure_event);
 perform pg_temp.settlement_check(correction->>'outcome'='failed' and correction->>'refund_reversal_entry_id' is not null,'terminal failure returns corrective entry');
 perform pg_temp.settlement_check(public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.refund_event('evt_failedAfterRefund','re_partialTwo','pi_second',650,'failed','refund.failed'))=correction,'exact failed refund replay');
 perform public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.refund_event('evt_failedDuplicate','re_partialTwo','pi_second',650,'failed','refund.updated'));
 perform pg_temp.settlement_check(public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.refund_event('evt_fullRefund','re_partialTwo','pi_second',650,'succeeded','refund.updated'))->>'outcome'='failed','old completed success replay respects terminal failure');
 perform pg_temp.settlement_check(public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.refund_event('evt_staleSuccess','re_partialTwo','pi_second',650,'succeeded','refund.updated'))->>'outcome'='failed','new event stale success respects terminal failure');
 perform pg_temp.settlement_check(pg_temp.player_pence('35540000-0000-0000-0000-000000000012')=650,'succeeded then failed restores money exactly once while paused');
 perform pg_temp.settlement_check((select e.kind='reversal' and e.amount_pence=650 and e.linked_entry_id=f.original_refund_entry_id and e.description='Stripe refund failed' from public.stripe_refund_failures f join public.account_entries e on e.id=f.reversal_entry_id where f.refund_id='re_partialTwo' and f.club_id='35540000-0000-0000-0000-000000000100'),'corrective credit links preserved original refund');
 perform pg_temp.settlement_refused(format('select public.process_stripe_settlement_event(%L,%L::jsonb)','acct_settlementPlatform',pg_temp.refund_event('evt_wrongFailureAmount','re_partialTwo','pi_second',651,'failed')),'22023','failed refund amount mismatch cannot credit');
 perform pg_temp.settlement_refused(format('select public.process_stripe_settlement_event(%L,%L::jsonb)','acct_settlementPlatform',jsonb_set(pg_temp.refund_event('evt_wrongFailureMode','re_partialTwo','pi_second',650,'failed'),'{data,object,livemode}','true')),'22023','contradictory object mode cannot credit');
 perform pg_temp.settlement_refused(format('select public.process_stripe_settlement_event(%L,%L::jsonb)','acct_settlementPlatform',jsonb_set(pg_temp.refund_event('evt_wrongEnvelopeMode','re_partialTwo','pi_second',650,'failed'),'{livemode}','true')),'P0002','wrong signed mode cannot resolve original refund');
 perform pg_temp.settlement_refused(format('select public.process_stripe_settlement_event(%L,%L::jsonb)','acct_settlementPlatform',jsonb_set(pg_temp.refund_event('evt_wrongFailureAccount','re_partialTwo','pi_second',650,'failed'),'{account}','"acct_wrongRefundAccount"')),'P0002','wrong connected account cannot resolve original refund');
 select count(*) into before_count from public.account_entries where club_id='35540000-0000-0000-0000-000000000100';
 perform public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.refund_event('evt_neverPostedFailure','re_neverPosted','pi_second',100,'failed','refund.failed'));
 perform public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.refund_event('evt_neverPostedDuplicate','re_neverPosted','pi_second',100,'failed','refund.updated'));
 perform pg_temp.settlement_check(public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.refund_event('evt_neverPostedStaleSuccess','re_neverPosted','pi_second',100,'succeeded'))->>'outcome'='failed','failure before posted debit suppresses stale success');
 perform pg_temp.settlement_check((select count(*)=before_count from public.account_entries where club_id='35540000-0000-0000-0000-000000000100') and (select original_refund_entry_id is null and reversal_entry_id is null from public.stripe_refund_failures where refund_id='re_neverPosted' and club_id='35540000-0000-0000-0000-000000000100'),'failure before any debit has no balance impact');
 perform public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.refund_event('evt_replacementRefund','re_replacement','pi_second',650,'succeeded'));
 perform pg_temp.settlement_check(pg_temp.player_pence('35540000-0000-0000-0000-000000000012')=0,'new genuine replacement refund can use capacity returned by failed refund');
end; $$;
-- Interrupt after ledger+attempt effects, before completion: all must roll back.
create function pg_temp.settlement_injected_failure() returns trigger language plpgsql as $$
begin if new.event_id in ('evt_interrupted','evt_refundFailureInterrupted') then raise exception 'Injected completion failure' using errcode='P0001'; end if; return new; end; $$;
create trigger settlement_test_failure before insert on public.stripe_settlement_events for each row execute function pg_temp.settlement_injected_failure();
select pg_temp.settlement_refused(format('select public.process_stripe_settlement_event(%L,%L::jsonb)','acct_settlementPlatform',pg_temp.payment_event('evt_interrupted','payment_intent.succeeded',23,'pi_third')),'P0001','interruption before completion injected');
select pg_temp.settlement_check(not exists(select 1 from public.stripe_settled_payments where payment_intent_id='pi_third') and (select status='pending' and receipt_entry_id is null and payment_intent_id is null from public.stripe_checkout_attempts where id='35540000-0000-0000-0000-000000000023'),'interruption rolls back payment ledger and attempt binding');
select pg_temp.settlement_refused(format('select public.process_stripe_settlement_event(%L,%L::jsonb)','acct_settlementPlatform',pg_temp.refund_event('evt_refundFailureInterrupted','re_partialOne','pi_second',250,'failed','refund.failed')),'P0001','interruption after corrective credit before event completion');
select pg_temp.settlement_check(pg_temp.player_pence('35540000-0000-0000-0000-000000000012')=0 and not exists(select 1 from public.stripe_refund_failures where refund_id='re_partialOne' and club_id='35540000-0000-0000-0000-000000000100'),'interruption rolls back both corrective credit and terminal failure fact');
drop trigger settlement_test_failure on public.stripe_settlement_events;
do $$ begin
 perform public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.refund_event('evt_refundFailureInterrupted','re_partialOne','pi_second',250,'failed','refund.failed'));
 perform public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.refund_event('evt_refundFailureInterrupted','re_partialOne','pi_second',250,'failed','refund.failed'));
 perform pg_temp.settlement_check(pg_temp.player_pence('35540000-0000-0000-0000-000000000012')=250,'failed refund correction retries once after interrupted processing');
end; $$;
do $$ begin
 perform public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.payment_event('evt_interrupted','payment_intent.succeeded',23,'pi_third'));
 perform public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.payment_event('evt_interrupted','payment_intent.succeeded',23,'pi_third'));
 perform pg_temp.settlement_refused(format('select public.process_stripe_settlement_event(%L,%L::jsonb)','acct_settlementPlatform',pg_temp.payment_event('evt_duplicatePI','payment_intent.succeeded',24,'pi_primary')),'23505','same PI cannot credit second attempt or player');
 perform public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.payment_event('evt_fourth','checkout.session.async_payment_succeeded',24,'pi_fourth'));
 perform public.process_stripe_settlement_event('acct_settlementPlatform',pg_temp.payment_event('evt_fourthPI','payment_intent.succeeded',24,'pi_fourth'));
 perform pg_temp.settlement_check((select count(*)=4 and sum(amount_pence)=3600 from public.stripe_settled_payments where club_id='35540000-0000-0000-0000-000000000100'),'separate genuine equal amount payments each retained once');
 perform pg_temp.settlement_check((select amount_pence=-700 from public.account_entries where source_id='settlement-match'),'refunds do not alter activity charges');
end; $$;
set local role authenticated;
select pg_temp.settlement_refused($q$select public.process_stripe_settlement_event('acct_settlementPlatform','{}')$q$,'42501','browser cannot settle');
select pg_temp.settlement_refused($q$select * from public.stripe_settlement_events$q$,'42501','browser cannot read webhook payloads');
select pg_temp.settlement_refused($q$select * from public.stripe_refund_failures$q$,'42501','browser cannot read or forge terminal provider facts');
reset role;
set local role service_role;
select pg_temp.settlement_refused($q$insert into public.stripe_refund_failures(platform_account_id) values('acct_forged')$q$,'42501','service direct terminal fact insert refused');
select pg_temp.settlement_refused($q$insert into public.stripe_settled_payments(platform_account_id) values('acct_forged')$q$,'42501','service direct settlement insert refused');
reset role;
set local role anon;
select pg_temp.settlement_refused($q$select public.process_stripe_settlement_event('acct_settlementPlatform','{}')$q$,'42501','anonymous cannot settle');
reset role;
select 'ALL STRIPE SETTLEMENT TESTS PASSED';
rollback;
