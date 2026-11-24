-- NOT-48 rollback proof. Worker owns synthetic 48520000 fixtures only.
begin;
create function pg_temp.training_check(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end; $$;
create function pg_temp.training_refused(statement text,expected text,label text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when others then
  if SQLSTATE=expected then return; end if;
  raise exception 'FAIL: % expected %, got %: %',label,expected,SQLSTATE,SQLERRM;
 end;
 raise exception 'FAIL: % unexpectedly succeeded',label;
end; $$;
create function pg_temp.training_request(n integer) returns uuid language sql as $$
 select ('48520000-0000-0000-0002-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.training_save(request uuid,session uuid,ids uuid[]) returns jsonb language plpgsql as $$
declare r jsonb:=public.get_training_attendance_register(session); begin
 return public.confirm_training_attendance(request,session,(r->>'revision')::integer,r->>'occurrence_fingerprint',ids);
end; $$;
grant execute on function pg_temp.training_check(boolean,text),pg_temp.training_refused(text,text,text),
 pg_temp.training_request(integer),pg_temp.training_save(uuid,uuid,uuid[]) to authenticated,anon;
insert into public.clubs(id,name,created_at) values
 ('48520000-0000-0000-0000-000000000100','Training fee test club',now()+interval '1 day'),
 ('48520000-0000-0000-0000-000000000101','Other training fee club',now()+interval '1 day');
insert into auth.users(id,email,raw_user_meta_data) values
 ('48520000-0000-0000-0000-000000000010','trainingfee.manager@example.invalid','{"first_name":"Training","last_name":"Manager","phone":"07700900610"}'),
 ('48520000-0000-0000-0000-000000000011','trainingfee.absent@example.invalid','{"first_name":"Absent","last_name":"Player","phone":"07700900611"}'),
 ('48520000-0000-0000-0000-000000000012','trainingfee.attendee@example.invalid','{"first_name":"Actual","last_name":"Attendee","phone":"07700900612"}'),
 ('48520000-0000-0000-0000-000000000013','trainingfee.correction@example.invalid','{"first_name":"Corrected","last_name":"Attendee","phone":"07700900613"}'),
 ('48520000-0000-0000-0000-000000000014','trainingfee.other@example.invalid','{"first_name":"Other","last_name":"Manager","phone":"07700900614"}'),
 ('48520000-0000-0000-0000-000000000015','trainingfee.pending@example.invalid','{"first_name":"Pending","last_name":"Manager","phone":"07700900615"}');
update public.profiles set club_id='48520000-0000-0000-0000-000000000100',approved=true where id::text like '48520000-%';
update public.profiles set role='admin' where id in('48520000-0000-0000-0000-000000000010','48520000-0000-0000-0000-000000000014','48520000-0000-0000-0000-000000000015');
update public.profiles set approved=false where id='48520000-0000-0000-0000-000000000015';
update public.profiles set club_id='48520000-0000-0000-0000-000000000101' where id='48520000-0000-0000-0000-000000000014';
insert into public.training_sessions(id,club_id,start_date,start_time,venue,town,audience,cancelled,series_id)
 select ('48520000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'48520000-0000-0000-0000-000000000100',
 case n when 21 then '2025-12-31'::date when 23 then (now() at time zone 'Europe/London')::date+7 when 25 then '2024-12-01'::date else '2026-01-01'::date end,
 '19:00','Original training pitch','Nottingham','xl',n=24,
 case when n in(21,22) then '48520000-0000-0000-0000-000000000060'::uuid else null end from generate_series(21,25) n;
insert into public.training_replies(session_id,profile_id,status) values('48520000-0000-0000-0000-000000000021','48520000-0000-0000-0000-000000000011','in');
select public.set_club_payments_release('48520000-0000-0000-0000-000000000100',true,true);
select public.set_club_payments_release('48520000-0000-0000-0000-000000000101',true,true);
set local role authenticated;
select set_config('request.jwt.claim.sub','48520000-0000-0000-0000-000000000010',true);
select public.set_club_fee_rate('training',400,'2025-01-01');
select public.set_club_fee_rate('training',600,'2026-01-01');
select public.set_club_fee_rate('training',0,'2026-02-01');
select pg_temp.training_check((select count(*)=0 from public.account_entries),'advance In reply posts no fee');
do $$ declare r jsonb; saved jsonb; latest jsonb; begin
 r:=public.get_training_attendance_register('48520000-0000-0000-0000-000000000021');
 saved:=public.confirm_training_attendance(pg_temp.training_request(1),'48520000-0000-0000-0000-000000000021',0,r->>'occurrence_fingerprint',array['48520000-0000-0000-0000-000000000012']::uuid[]);
 perform pg_temp.training_check((select count(*)=1 and sum(amount_pence)=-400 from public.account_entries),'only actual attendee charged old event-date rate');
 perform pg_temp.training_check((public.get_player_account('48520000-0000-0000-0000-000000000011')->>'balance_pence')::bigint=0,'In but absent uncharged');
 perform pg_temp.training_check((select category='training' and activity_type='training_session' and activity_snapshot->>'session_id'='48520000-0000-0000-0000-000000000021' and activity_snapshot->>'venue'='Original training pitch' and activity_snapshot->>'date'='2025-12-31' and activity_snapshot->>'fee_rate_id' is not null from public.account_entries),'original session date venue and rate snapshot');
 latest:=pg_temp.training_save(pg_temp.training_request(2),'48520000-0000-0000-0000-000000000021',array['48520000-0000-0000-0000-000000000012']::uuid[]);
 perform pg_temp.training_check((select count(*)=1 from public.account_entries),'unchanged second confirmation no duplicate debit');
 perform pg_temp.training_check(public.confirm_training_attendance(pg_temp.training_request(1),'48520000-0000-0000-0000-000000000021',0,r->>'occurrence_fingerprint',array['48520000-0000-0000-0000-000000000012']::uuid[])=saved,'old exact request replay returns saved result');
 perform pg_temp.training_refused(format('select public.confirm_training_attendance(%L,%L,1,%L,%L::uuid[])',pg_temp.training_request(3),'48520000-0000-0000-0000-000000000021',latest->>'occurrence_fingerprint','{}'),'40001','stale attendance revision refused');
 perform pg_temp.training_refused(format('select public.confirm_training_attendance(%L,%L,0,%L,%L::uuid[])',pg_temp.training_request(1),'48520000-0000-0000-0000-000000000021',r->>'occurrence_fingerprint','{}'),'22023','changed replay refused');
end; $$;
do $$ begin perform pg_temp.training_save(pg_temp.training_request(3),'48520000-0000-0000-0000-000000000022',array['48520000-0000-0000-0000-000000000012']::uuid[]); end; $$;
select pg_temp.training_check((select count(*)=2 and sum(amount_pence)=-1000 from public.account_entries),'next recurring occurrence independently charges new rate');
select pg_temp.training_check((public.get_training_attendance_register('48520000-0000-0000-0000-000000000022')->>'revision')::integer=1 and (public.get_training_attendance_register('48520000-0000-0000-0000-000000000021')->>'revision')::integer=2,'separate recurring attendance revisions');
reset role;
-- Prove removal and replacement are one financial difference even on failure.
create function pg_temp.training_injected_failure() returns trigger language plpgsql as $$
begin
 if new.source_id like 'attendance:48520000-0000-0000-0002-000000000004:add:%' then raise exception 'Injected training fee failure' using errcode='P0001'; end if;
 return new;
end; $$;
create trigger training_fee_test_failure before insert on public.account_entries for each row execute function pg_temp.training_injected_failure();
set local role authenticated;
select set_config('request.jwt.claim.sub','48520000-0000-0000-0000-000000000010',true);
select pg_temp.training_refused($q$select pg_temp.training_save(pg_temp.training_request(4),'48520000-0000-0000-0000-000000000021',array['48520000-0000-0000-0000-000000000013']::uuid[])$q$,'P0001','failure after removal before new fee injected');
select pg_temp.training_check((select count(*)=2 from public.account_entries) and (public.get_training_attendance_register('48520000-0000-0000-0000-000000000021')->>'revision')::integer=2,'failed correction leaves ledger and register unchanged');
reset role;
drop trigger training_fee_test_failure on public.account_entries;
set local role authenticated;
select set_config('request.jwt.claim.sub','48520000-0000-0000-0000-000000000010',true);
do $$ declare r jsonb; entry uuid; before_count bigint; begin
 r:=pg_temp.training_save(pg_temp.training_request(4),'48520000-0000-0000-0000-000000000021',array['48520000-0000-0000-0000-000000000013']::uuid[]);
 perform pg_temp.training_check((select amount_pence=400 and linked_entry_id is not null and category='training' and activity_snapshot->>'date'='2025-12-31' from public.account_entries where kind='reversal'),'attendance correction reverses exact original rate');
 perform pg_temp.training_check((public.get_player_account('48520000-0000-0000-0000-000000000012')->>'balance_pence')::bigint=-600 and (public.get_player_account('48520000-0000-0000-0000-000000000013')->>'balance_pence')::bigint=-400,'correction changes affected occurrence only');
 select e.id into entry from public.account_entries e join public.player_accounts a on a.id=e.account_id where a.profile_id='48520000-0000-0000-0000-000000000013' and e.kind='charge';
 perform public.reverse_account_entry(pg_temp.training_request(5),entry,'Training fee waived');
 select count(*) into before_count from public.account_entries;
 r:=pg_temp.training_save(pg_temp.training_request(6),'48520000-0000-0000-0000-000000000021',array['48520000-0000-0000-0000-000000000013']::uuid[]);
 perform pg_temp.training_check((select count(*)=before_count from public.account_entries),'unchanged register preserves administrative waiver');
 perform pg_temp.training_save(pg_temp.training_request(7),'48520000-0000-0000-0000-000000000021','{}');
 perform pg_temp.training_check((select count(*)=before_count from public.account_entries),'removing waived attendance does not reverse twice');
 perform pg_temp.training_save(pg_temp.training_request(8),'48520000-0000-0000-0000-000000000021',array['48520000-0000-0000-0000-000000000013']::uuid[]);
 perform pg_temp.training_check((public.get_player_account('48520000-0000-0000-0000-000000000013')->>'balance_pence')::bigint=-400,'re-add gives one fresh net fee');
end; $$;
reset role;
select public.anonymise_and_delete_profile('48520000-0000-0000-0000-000000000013','48520000-0000-0000-0000-000000000100');
set local role authenticated;
select set_config('request.jwt.claim.sub','48520000-0000-0000-0000-000000000010',true);
select pg_temp.training_check(exists(select 1 from jsonb_array_elements(public.get_training_attendance_register('48520000-0000-0000-0000-000000000021')->'players') p where p->>'profile_id'='48520000-0000-0000-0000-000000000013' and (p->>'confirmed')::boolean and not(p->>'eligible')::boolean),'removed prior attendee remains traceable');
do $$ begin perform pg_temp.training_save(pg_temp.training_request(9),'48520000-0000-0000-0000-000000000021','{}'); end; $$;
select pg_temp.training_check((public.get_player_account('48520000-0000-0000-0000-000000000013')->>'balance_pence')::bigint=0,'hard-removed attendee original fee can be reversed');
reset role;
create temporary table training_before_cancel as select public.get_training_attendance_register('48520000-0000-0000-0000-000000000022') value;
grant select on training_before_cancel to authenticated;
-- Existing £6 is retained in its original snapshot even if session metadata
-- moves to a date whose currently configured fee is zero before cancellation.
update public.training_sessions set start_date='2026-02-01',venue='Changed training pitch',cancelled=true,revision=revision+1 where id='48520000-0000-0000-0000-000000000022';
set local role authenticated;
select set_config('request.jwt.claim.sub','48520000-0000-0000-0000-000000000010',true);
do $$ declare old_r jsonb; fresh jsonb; before_count bigint; begin
 select value into old_r from pg_temp.training_before_cancel;
 select count(*) into before_count from public.account_entries;
 perform pg_temp.training_refused(format('select public.confirm_training_attendance(%L,%L,1,%L,%L::uuid[])',pg_temp.training_request(10),'48520000-0000-0000-0000-000000000022',old_r->>'occurrence_fingerprint','{}'),'40001','stale cancellation or edit refused before reversal');
 perform pg_temp.training_check((select count(*)=before_count from public.account_entries),'stale cancellation submission posts no entries');
 fresh:=public.get_training_attendance_register('48520000-0000-0000-0000-000000000022');
 perform pg_temp.training_check(not(fresh->>'can_confirm')::boolean and (fresh->>'allow_clear')::boolean and (fresh->>'occurrence_revision')::integer=2,'cancelled confirmed register offers explicit clear');
 perform pg_temp.training_refused($q$select pg_temp.training_save(pg_temp.training_request(10),'48520000-0000-0000-0000-000000000022',array['48520000-0000-0000-0000-000000000012']::uuid[])$q$,'22023','fresh cancelled nonempty attendance refused');
 fresh:=pg_temp.training_save(pg_temp.training_request(10),'48520000-0000-0000-0000-000000000022','{}');
 perform pg_temp.training_check((select amount_pence=600 and activity_snapshot->>'date'='2026-01-01' and activity_snapshot->>'venue'='Original training pitch' from public.account_entries where kind='reversal' and activity_id='48520000-0000-0000-0000-000000000022'),'fresh cancellation clear reverses original £6 date and venue');
 perform pg_temp.training_check((select sum(amount_pence)=0 from public.account_entries),'cleared occurrences leave no net fee');
end; $$;
select pg_temp.training_refused($q$select pg_temp.training_save(pg_temp.training_request(11),'48520000-0000-0000-0000-000000000023',array['48520000-0000-0000-0000-000000000012']::uuid[])$q$,'22023','future session additions refused');
select pg_temp.training_refused($q$select pg_temp.training_save(pg_temp.training_request(11),'48520000-0000-0000-0000-000000000023','{}')$q$,'22023','first empty future save refused');
select pg_temp.training_refused($q$select pg_temp.training_save(pg_temp.training_request(12),'48520000-0000-0000-0000-000000000024','{}')$q$,'22023','first empty cancelled save refused');
select pg_temp.training_refused($q$select pg_temp.training_save(pg_temp.training_request(13),'48520000-0000-0000-0000-000000000025',array['48520000-0000-0000-0000-000000000012']::uuid[])$q$,'22023','missing session-date rate refused');
do $$ declare missing jsonb; result jsonb; before_count bigint; begin
 perform pg_temp.training_save(pg_temp.training_request(13),'48520000-0000-0000-0000-000000000025','{}');
 missing:=public.get_training_attendance_register('48520000-0000-0000-0000-000000000025');
 perform public.set_club_fee_rate('training',0,'2024-01-01');
 perform pg_temp.training_refused(format('select public.confirm_training_attendance(%L,%L,1,%L,%L::uuid[])',pg_temp.training_request(14),'48520000-0000-0000-0000-000000000025',missing->>'occurrence_fingerprint',array['48520000-0000-0000-0000-000000000012']::uuid[]),'40001','new applicable fee invalidates loaded hash');
 select count(*) into before_count from public.account_entries;
 result:=pg_temp.training_save(pg_temp.training_request(14),'48520000-0000-0000-0000-000000000025',array['48520000-0000-0000-0000-000000000012']::uuid[]);
 perform pg_temp.training_check((select count(*)=before_count from public.account_entries) and jsonb_array_length(result->'confirmed_profile_ids')=1,'zero fee records attendance without fictional ledger entry');
 perform pg_temp.training_save(pg_temp.training_request(15),'48520000-0000-0000-0000-000000000025','{}');
 perform pg_temp.training_check((select count(*)=before_count from public.account_entries),'zero fee removal posts no invented reversal');
end; $$;
-- An ordinary edit alone also invalidates an open register, without a
-- cancellation or fee change masking the occurrence revision/hash check.
reset role;
create temporary table training_before_edit as select public.get_training_attendance_register('48520000-0000-0000-0000-000000000025') value;
grant select on training_before_edit to authenticated;
update public.training_sessions set venue='Edited active training pitch',revision=revision+1 where id='48520000-0000-0000-0000-000000000025';
set local role authenticated;
select set_config('request.jwt.claim.sub','48520000-0000-0000-0000-000000000010',true);
do $$ declare old_r jsonb; fresh jsonb; begin
 select value into old_r from pg_temp.training_before_edit;
 perform pg_temp.training_refused(format('select public.confirm_training_attendance(%L,%L,%L,%L,%L::uuid[])',pg_temp.training_request(16),'48520000-0000-0000-0000-000000000025',(old_r->>'revision')::integer,old_r->>'occurrence_fingerprint',array['48520000-0000-0000-0000-000000000012']::uuid[]),'40001','ordinary session edit invalidates loaded confirmation');
 fresh:=public.get_training_attendance_register('48520000-0000-0000-0000-000000000025');
 perform pg_temp.training_check((fresh->>'can_confirm')::boolean and fresh->>'revision'=old_r->>'revision' and jsonb_array_length(fresh->'confirmed_profile_ids')=0,'stale edit neither confirms attendance nor changes attendance revision');
end; $$;
select pg_temp.training_refused($q$select pg_temp.training_save(pg_temp.training_request(16),'48520000-0000-0000-0000-000000000025',array['48520000-0000-0000-0000-000000000014']::uuid[])$q$,'42501','foreign player addition refused');
select pg_temp.training_refused($q$select public.training_attendance_context('48520000-0000-0000-0000-000000000100','48520000-0000-0000-0000-000000000021')$q$,'42501','internal occurrence helper private');
select set_config('request.jwt.claim.sub','48520000-0000-0000-0000-000000000012',true);
select pg_temp.training_refused($q$select public.get_training_attendance_register('48520000-0000-0000-0000-000000000021')$q$,'42501','player register read refused');
select pg_temp.training_refused($q$select pg_temp.training_save(pg_temp.training_request(17),'48520000-0000-0000-0000-000000000025','{}')$q$,'42501','player attendance write refused');
select set_config('request.jwt.claim.sub','48520000-0000-0000-0000-000000000014',true);
select pg_temp.training_refused($q$select public.get_training_attendance_register('48520000-0000-0000-0000-000000000021')$q$,'42501','foreign manager occurrence read refused');
select set_config('request.jwt.claim.sub','48520000-0000-0000-0000-000000000015',true);
select pg_temp.training_refused($q$select public.get_training_attendance_register('48520000-0000-0000-0000-000000000021')$q$,'42501','unapproved manager register refused');
reset role;
delete from public.training_sessions where id='48520000-0000-0000-0000-000000000021';
select pg_temp.training_check((select bool_and(activity_snapshot->>'venue'='Original training pitch') from public.account_entries where activity_id='48520000-0000-0000-0000-000000000021'),'deleted session financial history retains original venue');
select public.set_club_payments_release('48520000-0000-0000-0000-000000000100',false,false);
set local role authenticated;
select set_config('request.jwt.claim.sub','48520000-0000-0000-0000-000000000010',true);
select pg_temp.training_refused($q$select public.get_training_attendance_register('48520000-0000-0000-0000-000000000022')$q$,'42501','pause hides training register');
select pg_temp.training_refused($q$select pg_temp.training_save(pg_temp.training_request(18),'48520000-0000-0000-0000-000000000022','{}')$q$,'42501','pause blocks attendance confirmation');
reset role;
set local role anon;
select pg_temp.training_refused($q$select public.get_training_attendance_register('48520000-0000-0000-0000-000000000022')$q$,'42501','anonymous training register refused');
reset role;
select 'ALL TRAINING ATTENDANCE FEE TESTS PASSED';
rollback;
