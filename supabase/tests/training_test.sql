-- Real PostgreSQL + Supabase auth roles. Run after migrations/seed; rolls back.
-- Dedicated namespace e900… is owned by this harness. No hosted calls or keys.
begin;
create function pg_temp.training_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'TRAINING FAIL: %',label; end if; end $$;
create function pg_temp.training_denied(stmt text,expected text default '42501') returns void language plpgsql as $$
begin
 begin execute stmt; exception when others then
  if sqlstate=expected then return; end if;
  raise exception 'TRAINING FAIL: expected %, got %: %',expected,sqlstate,sqlerrm;
 end;
 raise exception 'TRAINING FAIL: statement unexpectedly succeeded: %',stmt;
end $$;
create function pg_temp.training_actor(n integer) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub','e9000000-0000-0000-0000-'||lpad(n::text,12,'0'),'role','authenticated')::text,true)::text::void;
$$;
grant execute on function pg_temp.training_assert(boolean,text),pg_temp.training_denied(text,text),pg_temp.training_actor(integer) to anon,authenticated,service_role;
insert into clubs(id,name,created_at) values('e9111111-1111-1111-1111-111111111111','Training test other',now()+interval '1 hour');
insert into clubs(id,name) values('e9111111-1111-1111-1111-111111111110','Training proof club');
insert into teams(id,club_id,key,label) values('e9333333-3333-3333-3333-333333333330','e9111111-1111-1111-1111-111111111110','xl','Proof First Team'),('e9444444-4444-4444-4444-444444444440','e9111111-1111-1111-1111-111111111110','community','Proof Community');
insert into teams(id,club_id,key,label) values('e9333333-3333-3333-3333-333333333333','e9111111-1111-1111-1111-111111111111','community','Other Community');
insert into auth.users(id,email,raw_user_meta_data)
select ('e9000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'training-proof-'||n||'@example.invalid',
 jsonb_build_object('first_name','Proof '||n,'last_name','Synthetic','phone','07700900999','is_player',n<>5)
from generate_series(1,9) n;
update profiles set approved=true where id::text like 'e9000000-%' and id<>'e9000000-0000-0000-0000-000000000004';
update profiles set club_id='e9111111-1111-1111-1111-111111111110' where id::text like 'e9000000-%';
update profiles set role='admin' where id in ('e9000000-0000-0000-0000-000000000001','e9000000-0000-0000-0000-000000000008');
update profiles set active=false where id='e9000000-0000-0000-0000-000000000006';
update profiles set club_id='e9111111-1111-1111-1111-111111111111' where id in ('e9000000-0000-0000-0000-000000000007','e9000000-0000-0000-0000-000000000008');
delete from team_memberships where profile_id::text like 'e9000000-%';
insert into team_memberships(profile_id,team_id)
select ('e9000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'e9444444-4444-4444-4444-444444444440'::uuid from unnest(array[1,2,3,4,6]) n;
insert into team_memberships(profile_id,team_id) values
 ('e9000000-0000-0000-0000-000000000001','e9333333-3333-3333-3333-333333333330'),
 ('e9000000-0000-0000-0000-000000000003','e9333333-3333-3333-3333-333333333330'),
 ('e9000000-0000-0000-0000-000000000009','e9333333-3333-3333-3333-333333333330'),
 ('e9000000-0000-0000-0000-000000000007','e9333333-3333-3333-3333-333333333333'),
 ('e9000000-0000-0000-0000-000000000008','e9333333-3333-3333-3333-333333333333');
-- All actors have explicit synthetic device opt-in, including held/other club.
insert into push_tokens(profile_id,token)
select id,jsonb_build_object('endpoint','https://fcm.googleapis.com/fcm/send/training-proof-'||id::text,'keys',jsonb_build_object('p256dh','synthetic','auth','synthetic'))::text
from profiles where id::text like 'e9000000-%';

select pg_temp.training_actor(1); set local role authenticated;
select set_config('training.test.session',create_training_sessions('e9990000-0000-0000-0000-000000000001',current_date+14,'19:00','Club Ground','Old Town','community','PRIVATE focus',0,null)::text,true);
select pg_temp.training_assert(create_training_sessions('e9990000-0000-0000-0000-000000000001',current_date+14,'19:00','Club Ground','Old Town','community','PRIVATE focus',0,null)::text=current_setting('training.test.session'),'create retry identity');
select pg_temp.training_assert((select count(*) from training_headcount(current_setting('training.test.session')::uuid))=3,'eligible manager/community/both, once each');
select pg_temp.training_denied($s$select create_training_sessions('e9990000-0000-0000-0000-000000000001',current_date+15,'19:00','Club Ground','Old Town','community',null,0,null)$s$,'22023');
select pg_temp.training_actor(2);
select reply_to_training(current_setting('training.test.session')::uuid,1,'out');
select pg_temp.training_denied($s$select * from training_headcount(current_setting('training.test.session')::uuid)$s$);
select pg_temp.training_actor(3);
select reply_to_training(current_setting('training.test.session')::uuid,1,'in');
select pg_temp.training_denied($s$update training_replies set status='out'$s$);
select pg_temp.training_actor(9);
select pg_temp.training_assert((select count(*) from training_sessions where id=current_setting('training.test.session')::uuid)=0,'other squad cannot read private session');
select pg_temp.training_denied($s$select reply_to_training(current_setting('training.test.session')::uuid,1,'in')$s$);
select pg_temp.training_actor(5);
select pg_temp.training_assert((select count(*) from training_sessions where id=current_setting('training.test.session')::uuid)=0,'supporter cannot read squad session');
select pg_temp.training_denied($s$select reply_to_training(current_setting('training.test.session')::uuid,1,'in')$s$);
select pg_temp.training_actor(4);
select pg_temp.training_assert((select count(*) from training_sessions)=0,'pending gate');
select pg_temp.training_actor(6);
select pg_temp.training_assert((select count(*) from training_sessions)=0,'inactive gate');
select pg_temp.training_actor(8);
select pg_temp.training_denied($s$select change_training_session(current_setting('training.test.session')::uuid,1,'e9990000-0000-0000-0000-000000000010',current_date+15,'20:00','Other Ground','New Town',null,false)$s$);
select pg_temp.training_actor(1);
select pg_temp.training_assert(change_training_session(current_setting('training.test.session')::uuid,1,'e9990000-0000-0000-0000-000000000002',current_date+15,'20:00','Another Stadium','New Town','PRIVATE focus',false)=2,'move revision');
select pg_temp.training_assert((select count(*) from training_headcount(current_setting('training.test.session')::uuid) where status='in')=1,'move keeps In');
select pg_temp.training_assert((select count(*) from training_headcount(current_setting('training.test.session')::uuid) where status='out')=1,'move keeps Out');
select pg_temp.training_assert((select count(*) from training_headcount(current_setting('training.test.session')::uuid) where status is null)=1,'move keeps No reply');
select pg_temp.training_actor(3);
select pg_temp.training_denied($s$select reply_to_training(current_setting('training.test.session')::uuid,1,'out')$s$,'40001');
select reply_to_training(current_setting('training.test.session')::uuid,2,'maybe');
select pg_temp.training_actor(1);
select pg_temp.training_assert(change_training_session(current_setting('training.test.session')::uuid,1,'e9990000-0000-0000-0000-000000000002',current_date+15,'20:00','Another Stadium','New Town','PRIVATE focus',false)=2,'retry returns first revision');
select pg_temp.training_assert((select status from training_headcount(current_setting('training.test.session')::uuid) where profile_id='e9000000-0000-0000-0000-000000000003')='maybe','retry preserves intervening reply');
select pg_temp.training_assert((select count(*) from training_notices where session_id=current_setting('training.test.session')::uuid)=1,'move retry one club event');
select pg_temp.training_assert(change_training_session(current_setting('training.test.session')::uuid,2,'e9990000-0000-0000-0000-000000000003',current_date+15,'20:00','Another Stadium','New Town','PRIVATE focus',true)=3,'cancel revision');
select pg_temp.training_assert(change_training_session(current_setting('training.test.session')::uuid,2,'e9990000-0000-0000-0000-000000000003',current_date+15,'20:00','Another Stadium','New Town','PRIVATE focus',true)=3,'cancel retry');
select pg_temp.training_assert((select count(*) from training_headcount(current_setting('training.test.session')::uuid) where status is not null)=2,'cancel retains replies');
select pg_temp.training_actor(2);
select pg_temp.training_denied($s$select reply_to_training(current_setting('training.test.session')::uuid,3,'in')$s$,'22023');
select pg_temp.training_actor(9);
select pg_temp.training_assert((select count(*) from training_notices where session_id=current_setting('training.test.session')::uuid)=2,'other squad sees both notices');
select pg_temp.training_assert((select bool_and(body like '%20:00%' and body like '%Another Stadium%' and body not like '%PRIVATE%') from training_notices where session_id=current_setting('training.test.session')::uuid),'notice date time venue and no focus');
select pg_temp.training_actor(5);
select pg_temp.training_assert((select count(*) from training_notices where session_id=current_setting('training.test.session')::uuid)=2,'supporter sees both notices');
select pg_temp.training_actor(4);
select pg_temp.training_assert((select count(*) from training_notices)=0,'pending no notices');
select pg_temp.training_actor(6);
select pg_temp.training_assert((select count(*) from training_notices)=0,'inactive no notices');
select pg_temp.training_actor(7);
select pg_temp.training_assert((select count(*) from training_notices)=0,'other club no notices');
select pg_temp.training_denied($s$select * from training_push_claim(10)$s$);
reset role; set local role anon;
select pg_temp.training_denied($s$select * from training_notices$s$);
select pg_temp.training_denied($s$select * from training_sessions$s$);
reset role;
select pg_temp.training_assert((select count(*) from training_push_outbox where notice_id in(select id from training_notices where session_id=current_setting('training.test.session')::uuid))=10,'two events times five signed-off opted-in devices');
select pg_temp.training_assert(not exists(select 1 from training_push_outbox where profile_id in('e9000000-0000-0000-0000-000000000004','e9000000-0000-0000-0000-000000000006','e9000000-0000-0000-0000-000000000007','e9000000-0000-0000-0000-000000000008')),'no held/cross-club push');
select pg_temp.training_assert((select bool_and(not o.can_reply and o.body not like '%Update your availability%') from training_push_outbox o join training_notices n on n.id=o.notice_id where n.kind='cancelled'),'cancel no CTA');
select pg_temp.training_assert((select bool_and(not can_reply and body not like '%Update your availability%') from training_push_outbox where profile_id in('e9000000-0000-0000-0000-000000000005','e9000000-0000-0000-0000-000000000009')),'non-invitees no CTA');
select pg_temp.training_assert((select bool_and(o.can_reply and o.body like '%Update your availability%') from training_push_outbox o join training_notices n on n.id=o.notice_id where n.kind='moved' and o.profile_id='e9000000-0000-0000-0000-000000000002'),'eligible move CTA');

-- Worker claims are service-only; concurrent claims do not overlap and old
-- lease receipts cannot acknowledge a reclaimed event.
create temp table training_claims as select * from training_push_claim(1);
grant all on training_claims to service_role;
set local role service_role;
select pg_temp.training_assert((select count(*) from training_claims)=1,'claim one');
select pg_temp.training_assert(not training_push_finish((select id from training_claims),gen_random_uuid(),true,null),'wrong lease rejected');
select pg_temp.training_assert(training_push_finish((select id from training_claims),(select lease_token from training_claims),true,null),'matching lease finishes');
select pg_temp.training_assert(not training_push_finish((select id from training_claims),(select lease_token from training_claims),true,null),'duplicate finish rejected');
reset role;

-- Recurrence uses date arithmetic and preserves local start across GMT/BST.
select pg_temp.training_actor(1); set local role authenticated;
select set_config('training.test.series',create_training_sessions('e9990000-0000-0000-0000-000000000004','2028-03-19','19:00','Series Ground','Town','club',null,2,'2028-04-16')::text,true);
select pg_temp.training_assert((select count(*) from training_sessions where series_id=(select series_id from training_sessions where id=current_setting('training.test.series')::uuid))=3,'fortnightly inclusive end');
select pg_temp.training_assert((select count(distinct start_time) from training_sessions where series_id=(select series_id from training_sessions where id=current_setting('training.test.series')::uuid))=1,'stable local time');
select pg_temp.training_assert((select extract(epoch from((max(start_date)+max(start_time)) at time zone 'Europe/London')-((min(start_date)+min(start_time)) at time zone 'Europe/London')) from training_sessions where series_id=(select series_id from training_sessions where id=current_setting('training.test.series')::uuid))=28*86400-3600,'actual BST transition');
select pg_temp.training_denied($s$select create_training_sessions('e9990000-0000-0000-0000-000000000005',current_date+7,'19:00','Ground','','club',null,1,current_date+4000)$s$,'22023');
select pg_temp.training_actor(5);
select pg_temp.training_assert((select count(*) from training_sessions where id=current_setting('training.test.series')::uuid)=1,'supporter sees club session');
reset role;
-- Privacy regression: a legitimate club transfer after enqueue must suppress
-- old-club push details, even while the same device remains opted in.
select pg_temp.training_assert(exists(select 1 from training_push_outbox where profile_id='e9000000-0000-0000-0000-000000000002' and state='pending'),'transfer fixture has queued push');
update profiles set club_id='e9111111-1111-1111-1111-111111111111' where id='e9000000-0000-0000-0000-000000000002';
delete from team_memberships where profile_id='e9000000-0000-0000-0000-000000000002';
insert into team_memberships(profile_id,team_id) values('e9000000-0000-0000-0000-000000000002','e9333333-3333-3333-3333-333333333333');
create temp table training_transfer_claims as select * from training_push_claim(100);
select pg_temp.training_assert(not exists(select 1 from training_transfer_claims c join training_push_outbox o on o.id=c.id where o.profile_id='e9000000-0000-0000-0000-000000000002'),'transferred account never claims old-club event');
select pg_temp.training_assert(not exists(select 1 from training_push_outbox where profile_id='e9000000-0000-0000-0000-000000000002' and state in('pending','leased')),'transferred account queued events suppressed');
do $$ begin raise notice 'ALL TRAINING TESTS PASSED: RLS, transactions, idempotency, recurrence, notices and outbox'; end $$;
rollback;





