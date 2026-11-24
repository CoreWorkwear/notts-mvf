-- NOT-33 rollback proof. Ledger worker owns only the 33500000 namespace.
begin;
create function pg_temp.appearance_check(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end; $$;
create function pg_temp.appearance_refused(statement text,expected text,label text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when others then
  if SQLSTATE=expected then return; end if;
  raise exception 'FAIL: % expected %, got %: %',label,expected,SQLSTATE,SQLERRM;
 end;
 raise exception 'FAIL: % unexpectedly succeeded',label;
end; $$;
create function pg_temp.appearance_ids(lo integer,hi integer) returns uuid[] language sql as $$
 select coalesce(array_agg(('33500000-0000-0000-0001-'||lpad(n::text,12,'0'))::uuid order by n),'{}'::uuid[]) from generate_series(lo,hi) n;
$$;
create function pg_temp.appearance_request(n integer) returns uuid language sql as $$
 select ('33500000-0000-0000-0002-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.appearance_save(request uuid,fixture uuid,ids uuid[]) returns jsonb language plpgsql as $$
declare r jsonb:=public.get_fixture_appearance_register(fixture); begin
 return public.confirm_fixture_appearances(request,fixture,(r->>'revision')::integer,r->>'occurrence_fingerprint',ids);
end; $$;
grant execute on function pg_temp.appearance_check(boolean,text),pg_temp.appearance_refused(text,text,text),
 pg_temp.appearance_ids(integer,integer),pg_temp.appearance_request(integer),pg_temp.appearance_save(uuid,uuid,uuid[]) to authenticated,anon;
insert into public.clubs(id,name,created_at) values
 ('33500000-0000-0000-0000-000000000100','Appearance test club',now()+interval '1 day'),
 ('33500000-0000-0000-0000-000000000101','Other appearance club',now()+interval '1 day');
insert into public.seasons(id,club_id,label) values('33500000-0000-0000-0000-000000000102','33500000-0000-0000-0000-000000000100','Appearance season');
insert into public.teams(id,club_id,key,label,is_first_team) values
 ('33500000-0000-0000-0000-000000000103','33500000-0000-0000-0000-000000000100','xl','First Team',true),
 ('33500000-0000-0000-0000-000000000104','33500000-0000-0000-0000-000000000100','community','Community',false);
insert into public.opponents(id,club_id,name) values('33500000-0000-0000-0000-000000000105','33500000-0000-0000-0000-000000000100','Appearance opponents');
insert into public.fixtures(id,club_id,season_id,team_id,opponent_id,match_date,kickoff,venue,status)
 select ('33500000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'33500000-0000-0000-0000-000000000100',
 '33500000-0000-0000-0000-000000000102',case when n=26 then '33500000-0000-0000-0000-000000000104'::uuid else '33500000-0000-0000-0000-000000000103'::uuid end,
 '33500000-0000-0000-0000-000000000105',case when n=21 then '2025-12-31'::date when n=23 then (now() at time zone 'Europe/London')::date+7 else '2026-01-01'::date end,
 '11:00','Appearance pitch',case when n=24 then 'postponed' else 'scheduled' end from generate_series(21,26) n;
insert into public.results(fixture_id,us,them) select id,2,1 from public.fixtures where club_id='33500000-0000-0000-0000-000000000100' and id<>'33500000-0000-0000-0000-000000000025';
insert into auth.users(id,email,raw_user_meta_data) values
 ('33500000-0000-0000-0000-000000000010','appearance.manager@example.invalid','{"first_name":"Appearance","last_name":"Manager","phone":"07700900410"}'),
 ('33500000-0000-0000-0000-000000000011','appearance.other@example.invalid','{"first_name":"Other","last_name":"Manager","phone":"07700900411"}'),
 ('33500000-0000-0000-0000-000000000012','appearance.pending@example.invalid','{"first_name":"Pending","last_name":"Manager","phone":"07700900412"}');
insert into auth.users(id,email,raw_user_meta_data)
 select ('33500000-0000-0000-0001-'||lpad(n::text,12,'0'))::uuid, 'appearance.player'||n||'@example.invalid',jsonb_build_object('first_name','Appearance','last_name',lpad(n::text,2,'0'),'phone','077009005'||lpad(n::text,2,'0')) from generate_series(1,14) n;
update public.profiles set club_id='33500000-0000-0000-0000-000000000100',approved=true where id::text like '33500000-%';
update public.profiles set role='admin' where id in('33500000-0000-0000-0000-000000000010','33500000-0000-0000-0000-000000000011','33500000-0000-0000-0000-000000000012');
update public.profiles set club_id='33500000-0000-0000-0000-000000000101' where id='33500000-0000-0000-0000-000000000011';
update public.profiles set approved=false where id='33500000-0000-0000-0000-000000000012';
insert into public.lineups(fixture_id,profile_id,role) select '33500000-0000-0000-0000-000000000021',id,case when row_number()over()<=11 then 'start' else 'sub' end from unnest(pg_temp.appearance_ids(1,14)) id;
insert into public.availability(fixture_id,profile_id,status) select '33500000-0000-0000-0000-000000000021',id,'in' from unnest(pg_temp.appearance_ids(1,14)) id;
select public.set_club_payments_release('33500000-0000-0000-0000-000000000100',true,true);
select public.set_club_payments_release('33500000-0000-0000-0000-000000000101',true,true);
set local role authenticated;
select set_config('request.jwt.claim.sub','33500000-0000-0000-0000-000000000010',true);
select public.set_club_fee_rate('first_team',700,'2025-01-01');
select public.set_club_fee_rate('first_team',1000,'2026-01-01');
select pg_temp.appearance_check((select count(*)=0 from public.account_entries),'picks and In replies create no fees');
select pg_temp.appearance_check((public.get_fixture_appearance_register('33500000-0000-0000-0000-000000000021')->'rate'->>'amount_pence')::integer=700,'late old-year confirmation uses old price');
do $$ declare r jsonb; saved jsonb; latest jsonb; before_count bigint; begin
 r:=public.get_fixture_appearance_register('33500000-0000-0000-0000-000000000021');
 saved:=public.confirm_fixture_appearances(pg_temp.appearance_request(1),'33500000-0000-0000-0000-000000000021',0,r->>'occurrence_fingerprint',pg_temp.appearance_ids(1,12));
 perform pg_temp.appearance_check((saved->>'revision')::integer=1 and jsonb_array_length(saved->'confirmed_profile_ids')=12,'12 actual appearances confirmed');
 perform pg_temp.appearance_check((select count(*)=12 and sum(amount_pence)=-8400 from public.account_entries),'only 12 actual players charged including used sub');
 perform pg_temp.appearance_check((public.get_player_account('33500000-0000-0000-0001-000000000013')->>'balance_pence')::bigint=0 and (public.get_player_account('33500000-0000-0000-0001-000000000014')->>'balance_pence')::bigint=0,'unused selected substitutes uncharged');
 perform pg_temp.appearance_check((select bool_and(category='first_team' and activity_snapshot->>'team'='First Team' and activity_snapshot->>'date'='2025-12-31' and activity_snapshot->>'fee_rate_id' is not null and (activity_snapshot->>'fee_amount_pence')::integer=700) from public.account_entries),'original team date and rate snapshot');
 latest:=pg_temp.appearance_save(pg_temp.appearance_request(2),'33500000-0000-0000-0000-000000000021',pg_temp.appearance_ids(1,12));
 perform pg_temp.appearance_check((select count(*)=12 from public.account_entries),'unchanged new request posts no extra fees');
 perform pg_temp.appearance_check(public.confirm_fixture_appearances(pg_temp.appearance_request(1),'33500000-0000-0000-0000-000000000021',0,r->>'occurrence_fingerprint',pg_temp.appearance_ids(1,12))=saved,'exact old request returns saved result after newer save');
 perform pg_temp.appearance_refused(format('select public.confirm_fixture_appearances(%L,%L,0,%L,%L::uuid[])',pg_temp.appearance_request(1),'33500000-0000-0000-0000-000000000021',r->>'occurrence_fingerprint',pg_temp.appearance_ids(1,11)),'22023','changed replay conflicts');
 perform pg_temp.appearance_refused(format('select public.confirm_fixture_appearances(%L,%L,1,%L,%L::uuid[])',pg_temp.appearance_request(3),'33500000-0000-0000-0000-000000000021',latest->>'occurrence_fingerprint',pg_temp.appearance_ids(1,11)),'40001','stale manager revision refused');
 perform pg_temp.appearance_refused(format('select public.confirm_fixture_appearances(%L,%L,2,%L,%L::uuid[])',pg_temp.appearance_request(3),'33500000-0000-0000-0000-000000000021',latest->>'occurrence_fingerprint',array['33500000-0000-0000-0001-000000000001','33500000-0000-0000-0001-000000000001']::uuid[]),'22023','duplicate IDs refused');
end; $$;
reset role;
-- Fail an addition after a real removal has been posted; all effects must undo.
create function pg_temp.appearance_injected_failure() returns trigger language plpgsql as $$
begin
 if new.source_id like 'attendance:33500000-0000-0000-0002-000000000004:add:%' then raise exception 'Injected attendance failure' using errcode='P0001'; end if;
 return new;
end; $$;
create trigger appearance_test_failure before insert on public.account_entries for each row execute function pg_temp.appearance_injected_failure();
set local role authenticated;
select set_config('request.jwt.claim.sub','33500000-0000-0000-0000-000000000010',true);
select pg_temp.appearance_refused($q$select pg_temp.appearance_save(pg_temp.appearance_request(4),'33500000-0000-0000-0000-000000000021',pg_temp.appearance_ids(2,13))$q$,'P0001','posting failure after removal injected');
select pg_temp.appearance_check((select count(*)=12 from public.account_entries) and (public.get_fixture_appearance_register('33500000-0000-0000-0000-000000000021')->>'revision')::integer=2,'failed difference leaves ledger and revision unchanged');
reset role;
drop trigger appearance_test_failure on public.account_entries;
-- Change the occurrence/category after a manager's load. Fresh removal must
-- still reverse the original £7 First Team entry, with no Community rate set.
create temporary table appearance_old_context as select public.get_fixture_appearance_register('33500000-0000-0000-0000-000000000021') value;
grant select on appearance_old_context to authenticated;
update public.fixtures set team_id='33500000-0000-0000-0000-000000000104',kickoff='12:00' where id='33500000-0000-0000-0000-000000000021';
set local role authenticated;
select set_config('request.jwt.claim.sub','33500000-0000-0000-0000-000000000010',true);
do $$ declare r jsonb; old_r jsonb; begin
 select value into old_r from pg_temp.appearance_old_context;
 perform pg_temp.appearance_refused(format('select public.confirm_fixture_appearances(%L,%L,2,%L,%L::uuid[])',pg_temp.appearance_request(5),'33500000-0000-0000-0000-000000000021',old_r->>'occurrence_fingerprint',pg_temp.appearance_ids(2,12)),'40001','stale occurrence hash refused');
 r:=pg_temp.appearance_save(pg_temp.appearance_request(5),'33500000-0000-0000-0000-000000000021',pg_temp.appearance_ids(2,12));
 perform pg_temp.appearance_check((select amount_pence=700 and category='first_team' and activity_snapshot->>'team'='First Team' from public.account_entries where kind='reversal'),'removal reverses original amount and category after team change');
 perform pg_temp.appearance_check((public.get_player_account('33500000-0000-0000-0001-000000000001')->>'balance_pence')::bigint=0,'wrong appearance restored');
end; $$;
reset role;
update public.fixtures set team_id='33500000-0000-0000-0000-000000000103' where id='33500000-0000-0000-0000-000000000021';
set local role authenticated;
select set_config('request.jwt.claim.sub','33500000-0000-0000-0000-000000000010',true);
do $$ begin perform pg_temp.appearance_save(pg_temp.appearance_request(6),'33500000-0000-0000-0000-000000000021',pg_temp.appearance_ids(1,12)); end; $$;
select pg_temp.appearance_check((select sum(amount_pence)=-8400 and count(*)=14 from public.account_entries),'re-add fresh debit leaves one net fee each');
do $$ declare entry uuid; r jsonb; before_count bigint; begin
 select e.id into entry from public.account_entries e join public.player_accounts a on a.id=e.account_id where a.profile_id='33500000-0000-0000-0001-000000000002' and e.kind='charge';
 perform public.reverse_account_entry(pg_temp.appearance_request(7),entry,'Match fee waived');
 select count(*) into before_count from public.account_entries;
 r:=pg_temp.appearance_save(pg_temp.appearance_request(8),'33500000-0000-0000-0000-000000000021',pg_temp.appearance_ids(1,12));
 perform pg_temp.appearance_check((select count(*)=before_count from public.account_entries),'unchanged save never recreates administrative waiver');
 perform pg_temp.appearance_check(exists(select 1 from jsonb_array_elements(r->'players') p where p->>'profile_id'='33500000-0000-0000-0001-000000000002' and (p->>'waived')::boolean),'waived fee visible on register');
 r:=pg_temp.appearance_save(pg_temp.appearance_request(9),'33500000-0000-0000-0000-000000000021',pg_temp.appearance_ids(1,1)||pg_temp.appearance_ids(3,12));
 perform pg_temp.appearance_check((select count(*)=before_count from public.account_entries),'removing waived fee does not reverse twice');
 r:=pg_temp.appearance_save(pg_temp.appearance_request(10),'33500000-0000-0000-0000-000000000021',pg_temp.appearance_ids(1,12));
 perform pg_temp.appearance_check((select sum(amount_pence)=-8400 from public.account_entries),'re-add after waiver posts one fresh net fee');
end; $$;
reset role;
select public.anonymise_and_delete_profile('33500000-0000-0000-0001-000000000003','33500000-0000-0000-0000-000000000100');
set local role authenticated;
select set_config('request.jwt.claim.sub','33500000-0000-0000-0000-000000000010',true);
do $$ declare r jsonb; begin
 r:=public.get_fixture_appearance_register('33500000-0000-0000-0000-000000000021');
 perform pg_temp.appearance_check(exists(select 1 from jsonb_array_elements(r->'players') p where p->>'profile_id'='33500000-0000-0000-0001-000000000003' and not(p->>'eligible')::boolean and (p->>'confirmed')::boolean),'hard-removed prior attendee retained with snapshot');
 perform pg_temp.appearance_save(pg_temp.appearance_request(11),'33500000-0000-0000-0000-000000000021',pg_temp.appearance_ids(1,12));
 perform pg_temp.appearance_save(pg_temp.appearance_request(12),'33500000-0000-0000-0000-000000000021',pg_temp.appearance_ids(1,2)||pg_temp.appearance_ids(4,12));
 perform pg_temp.appearance_check((public.get_player_account('33500000-0000-0000-0001-000000000003')->>'balance_pence')::bigint=0,'removed player charge still reversed');
 perform pg_temp.appearance_refused($q$select pg_temp.appearance_save(pg_temp.appearance_request(13),'33500000-0000-0000-0000-000000000021',pg_temp.appearance_ids(1,12))$q$,'42501','hard-removed player cannot be newly added');
end; $$;
reset role;
update public.fixtures set status='postponed' where id='33500000-0000-0000-0000-000000000021';
set local role authenticated;
select set_config('request.jwt.claim.sub','33500000-0000-0000-0000-000000000010',true);
do $$ declare r jsonb; saved jsonb; begin
 r:=public.get_fixture_appearance_register('33500000-0000-0000-0000-000000000021');
 perform pg_temp.appearance_check(not(r->>'can_confirm')::boolean and (r->>'allow_clear')::boolean,'postponed existing register offers clear only');
 perform pg_temp.appearance_refused($q$select pg_temp.appearance_save(pg_temp.appearance_request(14),'33500000-0000-0000-0000-000000000021',pg_temp.appearance_ids(4,12))$q$,'22023','postponed fixture cannot retain nonempty new confirmation');
 saved:=public.confirm_fixture_appearances(pg_temp.appearance_request(14),'33500000-0000-0000-0000-000000000021',(r->>'revision')::integer,r->>'occurrence_fingerprint','{}');
 perform pg_temp.appearance_check(jsonb_array_length(saved->'confirmed_profile_ids')=0 and not(saved->>'allow_clear')::boolean,'empty cancellation closure clears confirmed players');
 perform pg_temp.appearance_check((select sum(amount_pence)=0 from public.account_entries),'cancelled match leaves no net fee');
 perform pg_temp.appearance_check(public.confirm_fixture_appearances(pg_temp.appearance_request(14),'33500000-0000-0000-0000-000000000021',(r->>'revision')::integer,r->>'occurrence_fingerprint','{}')=saved,'empty closure exact replay');
end; $$;
-- First-time empty/nonempty saves require real played state, not just a result
-- row or a past date considered alone.
select pg_temp.appearance_refused($q$select pg_temp.appearance_save(pg_temp.appearance_request(20),'33500000-0000-0000-0000-000000000023',pg_temp.appearance_ids(4,4))$q$,'22023','future kickoff despite result refused');
select pg_temp.appearance_refused($q$select pg_temp.appearance_save(pg_temp.appearance_request(20),'33500000-0000-0000-0000-000000000023','{}')$q$,'22023','first empty future confirmation refused');
select pg_temp.appearance_refused($q$select pg_temp.appearance_save(pg_temp.appearance_request(21),'33500000-0000-0000-0000-000000000024','{}')$q$,'22023','first empty postponed confirmation refused');
select pg_temp.appearance_refused($q$select pg_temp.appearance_save(pg_temp.appearance_request(22),'33500000-0000-0000-0000-000000000025',pg_temp.appearance_ids(4,4))$q$,'22023','past without result refused');
select pg_temp.appearance_refused($q$select pg_temp.appearance_save(pg_temp.appearance_request(22),'33500000-0000-0000-0000-000000000025','{}')$q$,'22023','first empty without result refused');
select pg_temp.appearance_refused($q$select pg_temp.appearance_save(pg_temp.appearance_request(23),'33500000-0000-0000-0000-000000000026',pg_temp.appearance_ids(4,4))$q$,'22023','missing rate blocks additions');
do $$ declare missing jsonb; empty_r jsonb; zero_r jsonb; before_count bigint; begin
 empty_r:=pg_temp.appearance_save(pg_temp.appearance_request(23),'33500000-0000-0000-0000-000000000026','{}');
 perform pg_temp.appearance_check((empty_r->>'revision')::integer=1,'played empty confirmation needs no fictional charge or fee');
 missing:=public.get_fixture_appearance_register('33500000-0000-0000-0000-000000000026');
 perform public.set_club_fee_rate('community',0,'2025-01-01');
 perform pg_temp.appearance_refused(format('select public.confirm_fixture_appearances(%L,%L,1,%L,%L::uuid[])',pg_temp.appearance_request(24),'33500000-0000-0000-0000-000000000026',missing->>'occurrence_fingerprint',pg_temp.appearance_ids(4,4)),'40001','changed applicable fee requires refresh');
 select count(*) into before_count from public.account_entries;
 zero_r:=pg_temp.appearance_save(pg_temp.appearance_request(24),'33500000-0000-0000-0000-000000000026',pg_temp.appearance_ids(4,4));
 perform pg_temp.appearance_check((select count(*)=before_count from public.account_entries) and jsonb_array_length(zero_r->'confirmed_profile_ids')=1,'zero rate confirms attendance without ledger debit');
 perform pg_temp.appearance_check(exists(select 1 from jsonb_array_elements(zero_r->'players') p where p->>'profile_id'='33500000-0000-0000-0001-000000000004' and p->'charge_entry_id'='null'::jsonb),'zero attendance has no invented charge ID');
 perform pg_temp.appearance_save(pg_temp.appearance_request(25),'33500000-0000-0000-0000-000000000026','{}');
 perform pg_temp.appearance_check((select count(*)=before_count from public.account_entries),'zero attendance removal posts no fictional reversal');
end; $$;
do $$ begin perform pg_temp.appearance_save(pg_temp.appearance_request(26),'33500000-0000-0000-0000-000000000022',pg_temp.appearance_ids(4,4)); end; $$;
select pg_temp.appearance_check((select amount_pence=-1000 and activity_snapshot->>'date'='2026-01-01' from public.account_entries where activity_id='33500000-0000-0000-0000-000000000022'),'new-year fixture uses new event-date price');
select pg_temp.appearance_refused($q$insert into public.activity_attendance_registers(club_id) values(gen_random_uuid())$q$,'42501','direct register writes refused');
select set_config('request.jwt.claim.sub','33500000-0000-0000-0001-000000000004',true);
select pg_temp.appearance_refused($q$select public.get_fixture_appearance_register('33500000-0000-0000-0000-000000000022')$q$,'42501','player register access refused');
select pg_temp.appearance_refused($q$select pg_temp.appearance_save(pg_temp.appearance_request(27),'33500000-0000-0000-0000-000000000022','{}')$q$,'42501','player cannot confirm');
select set_config('request.jwt.claim.sub','33500000-0000-0000-0000-000000000011',true);
select pg_temp.appearance_refused($q$select public.get_fixture_appearance_register('33500000-0000-0000-0000-000000000022')$q$,'42501','other-club register refused');
select set_config('request.jwt.claim.sub','33500000-0000-0000-0000-000000000012',true);
select pg_temp.appearance_refused($q$select public.get_fixture_appearance_register('33500000-0000-0000-0000-000000000022')$q$,'42501','unapproved manager refused');
reset role;
select public.set_club_payments_release('33500000-0000-0000-0000-000000000100',false,false);
set local role authenticated;
select set_config('request.jwt.claim.sub','33500000-0000-0000-0000-000000000010',true);
select pg_temp.appearance_refused($q$select public.get_fixture_appearance_register('33500000-0000-0000-0000-000000000022')$q$,'42501','pause hides register');
select pg_temp.appearance_refused($q$select pg_temp.appearance_save(pg_temp.appearance_request(28),'33500000-0000-0000-0000-000000000022','{}')$q$,'42501','pause blocks attendance changes');
reset role;
set local role anon;
select pg_temp.appearance_refused($q$select public.get_fixture_appearance_register('33500000-0000-0000-0000-000000000022')$q$,'42501','anonymous register refused');
reset role;
select 'ALL MATCH APPEARANCE FEE TESTS PASSED';
rollback;
