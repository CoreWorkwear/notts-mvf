-- Isolated rollback-only acceptance. Uses its own club and UUIDs. No push tokens.
begin;

do $$ begin
 if to_regprocedure('public.create_training_series(uuid,date,time,text,text,text,text,text,integer,integer[],date,integer,text,text,text,numeric,numeric)') is null then
   raise exception 'Apply 0044 before running the recurrence test';
 end if;
end $$;

insert into public.clubs(id,name) values ('ec444444-0000-4000-8000-000000000044','Recurrence QA');
insert into auth.users(id,email,raw_user_meta_data)
select id, email, jsonb_build_object('first_name','Recurrence','last_name','QA','phone','07700900044','is_player',true)
from (values
 ('ec444444-0000-4000-8000-000000000001'::uuid,'recurrence-manager@example.invalid'),
 ('ec444444-0000-4000-8000-000000000002'::uuid,'recurrence-player@example.invalid')
) as accounts(id,email);
update public.profiles set club_id='ec444444-0000-4000-8000-000000000044',approved=true,
 role=case when id='ec444444-0000-4000-8000-000000000001' then 'admin' else 'player' end
where id in ('ec444444-0000-4000-8000-000000000001','ec444444-0000-4000-8000-000000000002');

create function pg_temp.verify(ok boolean, description text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'Recurrence verification failed: %',description; end if;
end $$;
create function pg_temp.book(freq text, first_day date, step integer, weekdays integer[], until_day date, times integer,
  request_id uuid default gen_random_uuid()) returns uuid language sql as $$
  select public.create_training_series(request_id,first_day,'19:00','Club Ground','Nottingham','club','Set pieces',
                                  freq,step,weekdays,until_day,times,'1 Meadow Lane',' ng1 1aa ','///one.two.three',52.95,-1.15);
$$;
create function pg_temp.dates(first_id uuid) returns date[] language sql as $$
  select array_agg(s.start_date order by s.start_date) from public.training_sessions f join public.training_sessions s
    on s.series_id=f.series_id or s.id=f.id where f.id=first_id;
$$;
grant execute on function pg_temp.verify(boolean,text),pg_temp.book(text,date,integer,integer[],date,integer,uuid),pg_temp.dates(uuid) to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ec444444-0000-4000-8000-000000000001","role":"authenticated"}',true);

do $$
declare
  first_id uuid;
  one_id uuid;
  req uuid := gen_random_uuid();
  action_req uuid := gen_random_uuid();
  before_count int;
  n int;
begin
  first_id := pg_temp.book('week','2099-03-17',2,array[3,1],null,4,req);
  perform pg_temp.verify(pg_temp.dates(first_id)=array['2099-03-18','2099-03-30','2099-04-01','2099-04-13']::date[],
    'Tue start, Mon/Wed every second week, counting individual sessions');
  perform pg_temp.verify((select start_date=date '2099-03-18' and address='1 Meadow Lane' and postcode='NG1 1AA'
    and venue_lat=52.95 and venue_lng=-1.15 from public.training_sessions where id=first_id),'returns first actual occurrence and saves venue');
  perform pg_temp.verify((select count(*)=4 from public.training_sessions where series_id=(select series_id from public.training_sessions where id=first_id)
    and address='1 Meadow Lane' and w3w='///one.two.three' and start_time='19:00'), 'all occurrences keep venue and London wall-clock time across BST');
  perform pg_temp.verify(pg_temp.book('week','2099-03-17',2,array[1,3,3],null,4,req)=first_id,'equivalent weekday order and retry share receipt');
  perform pg_temp.verify(public.create_training_series(req,'2099-03-17','19:00','Club Ground','Nottingham','club','Set pieces',
    'week',2,array[1,3],null,4,'1 Meadow Lane',' ng1 1aa ','///one.two.three',null,null)=first_id,
    'a retry with unavailable derived coordinates returns the original booking');
  begin
    perform pg_temp.book('week','2099-03-17',2,array[1,3],null,5,req);
    raise exception 'Changed request id accepted';
  exception when sqlstate '22023' then null; end;
  perform pg_temp.verify(pg_temp.dates(pg_temp.book('week','2099-03-19',1,array[1,5],'2099-03-27',null))
    =array['2099-03-20','2099-03-23','2099-03-27']::date[], 'ends on included Friday');
  perform pg_temp.verify(pg_temp.dates(pg_temp.book('day','2099-02-27',2,null,null,3))
    =array['2099-02-27','2099-03-01','2099-03-03']::date[], 'every two days');
  perform pg_temp.verify(pg_temp.dates(pg_temp.book('month','2099-01-31',1,null,null,3))
    =array['2099-01-31','2099-03-31','2099-05-31']::date[], 'month end skips missing dates without drift');
  perform pg_temp.verify(pg_temp.dates(pg_temp.book('year','2096-02-29',1,null,null,2))
    =array['2096-02-29','2104-02-29']::date[], 'leap day skips Gregorian nonleap century');
  one_id := pg_temp.book('once','2099-01-01',1,null,null,1);
  perform pg_temp.verify((select series_id is null from public.training_sessions where id=one_id), 'one-off has no series');
  perform pg_temp.verify(cardinality(pg_temp.dates(pg_temp.book('day','2099-01-01',1,null,null,500)))=500,
    'accepts exactly 500 occurrences');

  select count(*) into before_count from public.training_sessions;
  for n in 1..9 loop
    begin
      case n
        when 1 then perform pg_temp.book('week','2099-03-17',1,array[1],'2099-03-19',null);
        when 2 then perform pg_temp.book('week','2099-03-17',1,array[8],null,3);
        when 3 then perform pg_temp.book('week','2099-03-17',1,'{}',null,3);
        when 4 then perform pg_temp.book('day','2099-03-17',1,null,null,null);
        when 5 then perform pg_temp.book('day','2099-03-17',1,null,'2099-04-01',3);
        when 6 then perform pg_temp.book('day','2099-03-17',1,null,null,501);
        when 7 then perform pg_temp.book('day','2099-03-17',1,null,'2101-03-17',null);
        when 8 then perform pg_temp.book('month','2099-03-17',0,null,null,1);
        when 9 then perform pg_temp.book('once','2099-03-17',1,null,null,2);
      end case;
      raise exception 'Invalid rule % accepted',n;
    exception when sqlstate '22023' then null; end;
  end loop;
  perform pg_temp.verify((select count(*) from public.training_sessions)=before_count,'invalid patterns insert no partial series');

  perform set_config('request.jwt.claims','{"sub":"ec444444-0000-4000-8000-000000000002","role":"authenticated"}',true);
  perform public.reply_to_training(first_id,1,'out');
  begin
    perform pg_temp.book('day','2099-01-01',1,null,null,1);
    raise exception 'Player published training';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims','{"sub":"ec444444-0000-4000-8000-000000000001","role":"authenticated"}',true);

  perform public.change_training_session_venue(first_id,1,action_req,'2099-03-18','19:00','Club Ground','Nottingham','Set pieces',false,
                                               '2 Meadow Lane','NG1 1AA','///one.two.three',52.95,-1.15);
  perform pg_temp.verify(public.change_training_session_venue(first_id,1,action_req,'2099-03-18','19:00','Club Ground','Nottingham','Set pieces',false,
                                               '2 Meadow Lane','NG1 1AA','///one.two.three',null,null)=2,'edit retry after failed geocoding returns first revision');
  perform pg_temp.verify((select count(*)=1 and bool_and(body like '%19:00%1 Meadow Lane%Nottingham%19:00%2 Meadow Lane%Nottingham%')
    from public.training_notices where session_id=first_id and kind='moved'), 'address-only move at same ground, one notice with both local details');
  perform public.change_training_session_venue(first_id,2,gen_random_uuid(),'2099-03-18','19:00','Club Ground','Nottingham','Set pieces',false,
                                               '2 Meadow Lane','NG2 2BB','///one.two.three',52.95,-1.15);
  perform public.change_training_session_venue(first_id,3,gen_random_uuid(),'2099-03-18','19:00','Club Ground','Nottingham','Set pieces',false,
                                               '2 Meadow Lane','NG2 2BB','///four.five.six',52.95,-1.15);
  perform public.change_training_session_venue(first_id,4,gen_random_uuid(),'2099-03-18','19:00','Club Ground','Nottingham','Set pieces',false,
                                               '2 Meadow Lane','NG2 2BB','///four.five.six',52.97,-1.20);
  perform pg_temp.verify((select count(*)=3 and bool_or(body like '%NG1 1AA%NG2 2BB%') and bool_or(body like '%///one.two.three%///four.five.six%')
    from public.training_notices where session_id=first_id and kind='moved'), 'postcode and what3words each notify, coordinate refresh is silent');
  perform public.change_training_session(first_id,5,gen_random_uuid(),'2099-03-18','19:00','Club Ground','Nottingham','Possession',false);
  perform public.change_training_session(first_id,6,gen_random_uuid(),'2099-03-18','19:00','Club Ground','Nottingham','Possession',true);
  perform pg_temp.verify((select cancelled and address='2 Meadow Lane' and postcode='NG2 2BB' and w3w='///four.five.six' and venue_lat=52.97
    from public.training_sessions where id=first_id),'legacy edit and cancellation preserve venue');
  perform pg_temp.verify((select count(*)=1 from public.training_notices where session_id=first_id and kind='cancelled'
    and body like '%19:00%2 Meadow Lane%Nottingham%NG2 2BB%'), 'distinct cancellation notice with current address and local start');
  perform pg_temp.verify((select status='out' from public.training_replies where session_id=first_id), 'reply survives moves and cancellation');
  perform pg_temp.verify((select count(*)=3 from public.training_sessions where series_id=(select series_id from public.training_sessions where id=first_id)
    and revision=1 and not cancelled and address='1 Meadow Lane'), 'siblings unchanged');
end $$;

do $$ begin raise notice 'ALL GRANULAR TRAINING TESTS PASSED'; end $$;
rollback;
