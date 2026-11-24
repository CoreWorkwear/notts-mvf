-- NOT-49 rollback proof; worker owns synthetic 49480000 namespace only.
begin;
create function pg_temp.correction_check(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end; $$;
create function pg_temp.correction_refused(statement text,expected text,label text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when others then
  if SQLSTATE=expected then return; end if;
  raise exception 'FAIL: % expected %, got %: %',label,expected,SQLSTATE,SQLERRM;
 end;
 raise exception 'FAIL: % unexpectedly succeeded',label;
end; $$;
grant execute on function pg_temp.correction_check(boolean,text),pg_temp.correction_refused(text,text,text) to authenticated,anon,service_role;
insert into public.clubs(id,name,created_at) values
 ('49480000-0000-0000-0000-000000000100','Correction test club',now()+interval '1 day'),
 ('49480000-0000-0000-0000-000000000101','Other correction club',now()+interval '1 day');
insert into auth.users(id,email,raw_user_meta_data) values
 ('49480000-0000-0000-0000-000000000010','correction.manager@example.invalid','{"first_name":"Correction","last_name":"Manager","phone":"07700900210"}'),
 ('49480000-0000-0000-0000-000000000011','correction.wrong@example.invalid','{"first_name":"Wrong","last_name":"Player","phone":"07700900211"}'),
 ('49480000-0000-0000-0000-000000000012','correction.right@example.invalid','{"first_name":"Right","last_name":"Player","phone":"07700900212"}'),
 ('49480000-0000-0000-0000-000000000013','correction.other@example.invalid','{"first_name":"Other","last_name":"Manager","phone":"07700900213"}'),
 ('49480000-0000-0000-0000-000000000014','correction.second@example.invalid','{"first_name":"Second","last_name":"Manager","phone":"07700900214"}'),
 ('49480000-0000-0000-0000-000000000015','correction.pending@example.invalid','{"first_name":"Pending","last_name":"Player","phone":"07700900215"}');
update public.profiles set club_id='49480000-0000-0000-0000-000000000100',approved=true where id::text like '49480000-%';
update public.profiles set role='admin' where id in('49480000-0000-0000-0000-000000000010','49480000-0000-0000-0000-000000000013','49480000-0000-0000-0000-000000000014');
update public.profiles set approved=false where id='49480000-0000-0000-0000-000000000015';
update public.profiles set club_id='49480000-0000-0000-0000-000000000101' where id='49480000-0000-0000-0000-000000000013';
select public.set_club_payments_release('49480000-0000-0000-0000-000000000100',true,true);
select public.set_club_payments_release('49480000-0000-0000-0000-000000000101',true,true);
select public.post_account_entry('{"club_id":"49480000-0000-0000-0000-000000000100","profile_id":"49480000-0000-0000-0000-000000000011","kind":"receipt","amount_pence":700,"source":"stripe_payment","source_id":"correction-stripe","description":"Verified provider receipt","occurred_on":"2026-12-01"}');
create temporary table correction_foreign_entry as select id from public.account_entries where source_id='correction-stripe';
grant select on correction_foreign_entry to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','49480000-0000-0000-0000-000000000010',true);
select public.record_account_receipt('49480000-0000-0000-0000-000000000020','49480000-0000-0000-0000-000000000011',900,'bank','Original reference','2026-12-01');
select public.record_account_receipt('49480000-0000-0000-0000-000000000021','49480000-0000-0000-0000-000000000011',600,'cash','Cash note','2026-12-01');
select pg_temp.correction_refused($q$select public.record_account_fine('49480000-0000-0000-0000-000000000030','49480000-0000-0000-0000-000000000011',500,'   ','2026-12-01')$q$,'22023','fine needs reason');
select pg_temp.correction_refused($q$select public.record_account_fine('49480000-0000-0000-0000-000000000030','49480000-0000-0000-0000-000000000011',-500,'Late','2026-12-01')$q$,'22023','fine positive input only');
select pg_temp.correction_refused($q$select public.record_account_fine('49480000-0000-0000-0000-000000000030','49480000-0000-0000-0000-000000000011',500,'Late','infinity')$q$,'22023','finite date only');
select pg_temp.correction_refused($q$select public.record_account_fine('49480000-0000-0000-0000-000000000030','49480000-0000-0000-0000-000000000013',500,'Late','2026-12-01')$q$,'42501','cross-club fine refused');
select pg_temp.correction_refused($q$select public.record_account_adjustment('49480000-0000-0000-0000-000000000030','49480000-0000-0000-0000-000000000011',0,'Correction','2026-12-01')$q$,'22023','zero adjustment refused');
select pg_temp.correction_refused($q$select public.record_account_adjustment('49480000-0000-0000-0000-000000000030','49480000-0000-0000-0000-000000000011',-2147483648,'Correction','2026-12-01')$q$,'22023','irreversible integer refused');
select pg_temp.correction_refused($q$select public.manager_account_change('49480000-0000-0000-0000-000000000030','fine','{}')$q$,'42501','generic manager helper private');
select public.record_account_fine('49480000-0000-0000-0000-000000000030','49480000-0000-0000-0000-000000000011',500,'Late arrival','2026-12-01');
do $$ declare fine uuid; credit uuid; debit uuid; reversal uuid; begin
 fine:=public.record_account_fine('49480000-0000-0000-0000-000000000030','49480000-0000-0000-0000-000000000011',500,'Late arrival','2026-12-01');
 perform pg_temp.correction_check((public.get_player_account('49480000-0000-0000-0000-000000000011')->>'balance_pence')::bigint=1700,'fine debit posted once');
 perform pg_temp.correction_check((select kind='charge' and amount_pence=-500 and description='Fine: Late arrival' and category='fines' and activity_snapshot->>'reason'='Late arrival' from public.account_entries where id=fine),'fine reason and report snapshot');
 reversal:=public.reverse_account_entry('49480000-0000-0000-0000-000000000031',fine,'Fine entered in error','2026-12-02');
 perform pg_temp.correction_check(public.reverse_account_entry('49480000-0000-0000-0000-000000000031',fine,'Fine entered in error','2026-12-02')=reversal,'exact reversal retry');
 perform pg_temp.correction_check((select amount_pence=500 and linked_entry_id=fine and category='fines' and occurred_on='2026-12-02' from public.account_entries where id=reversal),'fine reversal linked with own date');
 perform pg_temp.correction_refused(format('select public.reverse_account_entry(%L,%L,%L,%L)','49480000-0000-0000-0000-000000000032',fine,'Duplicate reversal','2026-12-02'),'22023','different request cannot reverse twice');
 perform pg_temp.correction_refused(format('select public.reverse_account_entry(%L,%L,%L,%L)','49480000-0000-0000-0000-000000000033',reversal,'Reverse reversal','2026-12-02'),'22023','cannot reverse reversal');
 credit:=public.record_account_adjustment('49480000-0000-0000-0000-000000000034','49480000-0000-0000-0000-000000000011',200,'Balance credit correction','2026-12-01');
 perform pg_temp.correction_check(public.record_account_adjustment('49480000-0000-0000-0000-000000000034','49480000-0000-0000-0000-000000000011',200,'Balance credit correction','2026-12-01')=credit,'adjustment exact retry');
 perform pg_temp.correction_check((select kind='adjustment' and description='Adjustment: Balance credit correction' and category is null from public.account_entries where id=credit),'adjustment distinct from receipt');
 perform public.reverse_account_entry('49480000-0000-0000-0000-000000000035',credit,'Undo credit','2026-12-02');
 debit:=public.record_account_adjustment('49480000-0000-0000-0000-000000000036','49480000-0000-0000-0000-000000000011',-300,'Balance debit correction','2026-12-01');
 perform public.reverse_account_entry('49480000-0000-0000-0000-000000000037',debit,'Undo debit','2026-12-02');
 perform pg_temp.correction_check((public.get_player_account('49480000-0000-0000-0000-000000000011')->>'balance_pence')::bigint=2200,'both adjustment directions reverse exact amounts');
end; $$;
select pg_temp.correction_refused($q$select public.record_account_fine('49480000-0000-0000-0000-000000000030','49480000-0000-0000-0000-000000000011',501,'Late arrival','2026-12-01')$q$,'22023','changed fine replay refused');
select pg_temp.correction_refused($q$select public.record_account_adjustment('49480000-0000-0000-0000-000000000030','49480000-0000-0000-0000-000000000011',500,'Late arrival','2026-12-01')$q$,'22023','same UUID different operation refused');
select set_config('request.jwt.claim.sub','49480000-0000-0000-0000-000000000014',true);
select pg_temp.correction_refused($q$select public.record_account_fine('49480000-0000-0000-0000-000000000030','49480000-0000-0000-0000-000000000011',500,'Late arrival','2026-12-01')$q$,'22023','same UUID different actor refused');
select set_config('request.jwt.claim.sub','49480000-0000-0000-0000-000000000010',true);
do $$ declare original uuid; provider uuid; result jsonb; begin
 select id into original from public.account_entries where source_id='49480000-0000-0000-0000-000000000020';
 select id into provider from public.account_entries where source_id='correction-stripe';
 perform pg_temp.correction_refused(format('select public.reverse_account_entry(%L,%L,%L,%L)','49480000-0000-0000-0000-000000000040',provider,'Provider reversal','2026-12-02'),'22023','Stripe remains provider-refund path');
 perform pg_temp.correction_refused(format('select public.correct_manual_receipt_player(%L,%L,%L,%L,%L)','49480000-0000-0000-0000-000000000040',provider,'49480000-0000-0000-0000-000000000012','Move Stripe','2026-12-02'),'22023','Stripe cannot move manually');
 perform pg_temp.correction_refused(format('select public.correct_manual_receipt_player(%L,%L,%L,%L,%L)','49480000-0000-0000-0000-000000000040',original,'49480000-0000-0000-0000-000000000011','Same player','2026-12-02'),'22023','same-player move refused');
 perform pg_temp.correction_refused(format('select public.correct_manual_receipt_player(%L,%L,%L,%L,%L)','49480000-0000-0000-0000-000000000040',original,'49480000-0000-0000-0000-000000000013','Cross club','2026-12-02'),'42501','cross-club move refused');
 result:=public.correct_manual_receipt_player('49480000-0000-0000-0000-000000000040',original,'49480000-0000-0000-0000-000000000012','Receipt credited to wrong player','2026-12-02');
 perform pg_temp.correction_check(public.correct_manual_receipt_player('49480000-0000-0000-0000-000000000040',original,'49480000-0000-0000-0000-000000000012','Receipt credited to wrong player','2026-12-02')=result,'wrong-player correction exact retry');
 perform pg_temp.correction_check((select amount_pence=900 and source='bank' and reference='Original reference' from public.account_entries where id=(result->>'receipt_entry_id')::uuid),'replacement preserves method amount and reference');
 perform pg_temp.correction_check((select linked_entry_id=original and amount_pence=-900 from public.account_entries where id=(result->>'reversal_entry_id')::uuid),'original receipt linked to full reversal');
 perform pg_temp.correction_check((public.get_player_account('49480000-0000-0000-0000-000000000011')->>'balance_pence')::bigint=1300 and (public.get_player_account('49480000-0000-0000-0000-000000000012')->>'balance_pence')::bigint=900,'both accounts corrected once');
 perform pg_temp.correction_check((select actor_id='49480000-0000-0000-0000-000000000010' and audit.result->>'original_entry_id'=original::text from public.manager_account_requests audit where request_id='49480000-0000-0000-0000-000000000040'),'atomic operation audit retains original/result/actor');
 perform pg_temp.correction_refused(format('select public.correct_manual_receipt_player(%L,%L,%L,%L,%L)','49480000-0000-0000-0000-000000000041',original,'49480000-0000-0000-0000-000000000012','Second move','2026-12-02'),'22023','second request cannot correct original again');
 perform pg_temp.correction_refused(format('select public.correct_manual_receipt_player(%L,%L,%L,%L,%L)','49480000-0000-0000-0000-000000000040',original,'49480000-0000-0000-0000-000000000012','Changed reason','2026-12-02'),'22023','changed correction replay refused');
end; $$;
reset role;
-- Fault injection forces replacement to fail AFTER reversal posting. The RPC
-- must roll the reversal back too. The injected conflicting fixture is itself
-- discarded by the outer subtransaction, leaving the genuine books unchanged.
do $$ declare original uuid; before_count bigint; begin
 begin
  perform public.post_account_entry('{"club_id":"49480000-0000-0000-0000-000000000100","profile_id":"49480000-0000-0000-0000-000000000011","kind":"receipt","amount_pence":1,"source":"cash","source_id":"manager:49480000-0000-0000-0000-000000000050:replacement","description":"Injected replacement conflict","occurred_on":"2026-12-02"}');
  select id into original from public.account_entries where source_id='49480000-0000-0000-0000-000000000021';
  select count(*) into before_count from public.account_entries where club_id='49480000-0000-0000-0000-000000000100';
  perform set_config('request.jwt.claim.sub','49480000-0000-0000-0000-000000000010',true);
  perform pg_temp.correction_refused(format('select public.correct_manual_receipt_player(%L,%L,%L,%L,%L)','49480000-0000-0000-0000-000000000050',original,'49480000-0000-0000-0000-000000000012','Interrupted move','2026-12-02'),'22023','replacement failure injected');
  perform pg_temp.correction_check((select count(*)=before_count from public.account_entries where club_id='49480000-0000-0000-0000-000000000100'),'no partial reversal after replacement failure');
  perform pg_temp.correction_check(not exists(select 1 from public.account_entries where linked_entry_id=original and kind='reversal'),'original still reversible after failed move');
  perform pg_temp.correction_check(not exists(select 1 from public.manager_account_requests where request_id='49480000-0000-0000-0000-000000000050'),'failed operation has no completion receipt');
  raise exception 'Discard injected fixture' using errcode='ZX001';
 exception when sqlstate 'ZX001' then null;
 end;
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','49480000-0000-0000-0000-000000000010',true);
select public.correct_manual_receipt_player('49480000-0000-0000-0000-000000000050',(select id from public.account_entries where source_id='49480000-0000-0000-0000-000000000021'),'49480000-0000-0000-0000-000000000012','Interrupted move','2026-12-02');
select pg_temp.correction_check((public.get_player_account('49480000-0000-0000-0000-000000000011')->>'balance_pence')::bigint=700 and (public.get_player_account('49480000-0000-0000-0000-000000000012')->>'balance_pence')::bigint=1500,'retry after failure fully moves cash');
select pg_temp.correction_check((public.get_activity_finance_report('2026-12-01','2026-12-02')->'receipts'->>'net_pence')::bigint=2200,'net club receipts count genuine money once');
select pg_temp.correction_check((public.get_activity_finance_report('2026-12-01','2026-12-02')->'totals'->>'net_charges_pence')::bigint=0,'fine reversal net zero and adjustments excluded');
do $$ declare entry uuid; begin
 entry:=public.record_account_fine('49480000-0000-0000-0000-000000000055','49480000-0000-0000-0000-000000000011',1,'London default date');
 perform pg_temp.correction_check((select occurred_on=(now() at time zone 'Europe/London')::date from public.account_entries where id=entry),'default accounting date is London today');
 perform public.reverse_account_entry('49480000-0000-0000-0000-000000000056',entry,'Undo date proof');
end; $$;
select pg_temp.correction_refused($q$insert into public.manager_account_requests(club_id) values(gen_random_uuid())$q$,'42501','direct audit insert refused');
select set_config('request.jwt.claim.sub','49480000-0000-0000-0000-000000000011',true);
select pg_temp.correction_check((select count(*)=0 from public.manager_account_requests),'player cannot read actor or correction audit');
select pg_temp.correction_refused($q$select public.record_account_fine('49480000-0000-0000-0000-000000000060','49480000-0000-0000-0000-000000000011',500,'Player attempt')$q$,'42501','player cannot fine');
select pg_temp.correction_refused($q$select public.record_account_adjustment('49480000-0000-0000-0000-000000000060','49480000-0000-0000-0000-000000000011',500,'Player attempt')$q$,'42501','player cannot adjust');
select set_config('request.jwt.claim.sub','49480000-0000-0000-0000-000000000013',true);
select pg_temp.correction_check((select count(*)=0 from public.manager_account_requests),'other manager cannot read audit');
select pg_temp.correction_refused($q$select public.reverse_account_entry('49480000-0000-0000-0000-000000000060',(select id from pg_temp.correction_foreign_entry),'Cross club')$q$,'42501','other manager cannot reverse our books');
reset role;
update public.profiles set role='admin' where id='49480000-0000-0000-0000-000000000015';
set local role authenticated;
select set_config('request.jwt.claim.sub','49480000-0000-0000-0000-000000000015',true);
select pg_temp.correction_check((select count(*)=0 from public.manager_account_requests),'unapproved manager cannot read audit');
select pg_temp.correction_refused($q$select public.record_account_adjustment('49480000-0000-0000-0000-000000000060','49480000-0000-0000-0000-000000000011',500,'Unapproved attempt')$q$,'42501','unapproved manager cannot post');
reset role;
select public.set_club_payments_release('49480000-0000-0000-0000-000000000100',false,false);
set local role authenticated;
select set_config('request.jwt.claim.sub','49480000-0000-0000-0000-000000000010',true);
select pg_temp.correction_refused($q$select public.record_account_fine('49480000-0000-0000-0000-000000000030','49480000-0000-0000-0000-000000000011',500,'Late arrival','2026-12-01')$q$,'42501','pause blocks even exact prior write retry');
select pg_temp.correction_refused($q$select public.record_account_adjustment('49480000-0000-0000-0000-000000000060','49480000-0000-0000-0000-000000000011',500,'Paused attempt')$q$,'42501','pause blocks new adjustment');
select pg_temp.correction_check((select count(*)=0 from public.manager_account_requests),'pause hides audit');
reset role;
set local role anon;
select pg_temp.correction_refused($q$select public.record_account_fine('49480000-0000-0000-0000-000000000060','49480000-0000-0000-0000-000000000011',500,'Anonymous attempt')$q$,'42501','anonymous correction refused');
reset role;
select 'ALL MANAGER ACCOUNT CORRECTION TESTS PASSED';
rollback;
