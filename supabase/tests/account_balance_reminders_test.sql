begin;
insert into public.clubs (id,name) values ('36560000-0000-0000-0000-000000000001','Account reminder proof');
insert into auth.users (id,email,raw_user_meta_data) values
 ('36560000-0000-0000-0000-000000000010','reminder-manager@example.invalid','{"first_name":"Manager","last_name":"Proof","phone":"07700900010"}'),
 ('36560000-0000-0000-0000-000000000011','reminder-debt@example.invalid','{"first_name":"Arrears","last_name":"Proof","phone":"07700900011"}'),
 ('36560000-0000-0000-0000-000000000012','reminder-credit@example.invalid','{"first_name":"Credit","last_name":"Proof","phone":"07700900012"}');
update public.profiles set club_id='36560000-0000-0000-0000-000000000001',approved=true
  where id::text like '36560000-%';
update public.profiles set role='admin' where id='36560000-0000-0000-0000-000000000010';
select public.set_club_payments_release('36560000-0000-0000-0000-000000000001',true,true);
select public.post_account_entry(jsonb_build_object('club_id','36560000-0000-0000-0000-000000000001',
  'profile_id','36560000-0000-0000-0000-000000000011','kind','opening','source','opening','source_id','reminder-arrears',
  'amount_pence',-700,'description','Opening balance'));
select public.post_account_entry(jsonb_build_object('club_id','36560000-0000-0000-0000-000000000001',
  'profile_id','36560000-0000-0000-0000-000000000012','kind','opening','source','opening','source_id','reminder-credit',
  'amount_pence',900,'description','Opening balance'));

set local role authenticated;
select set_config('request.jwt.claim.sub','36560000-0000-0000-0000-000000000010',true);
do $$
declare
  request constant uuid := '36560000-0000-0000-0000-000000000020';
  recipient constant uuid := '36560000-0000-0000-0000-000000000011';
  initial jsonb;
  replay jsonb;
begin
  if public.get_account_reminder_targets()->0->>'first_name' is distinct from 'Arrears' then
    raise exception 'Arrears target missing';
  end if;
  initial := public.create_account_reminder_batch(request);
  if initial->>'targeted' is distinct from '1' then raise exception 'Unexpected reminder targets'; end if;
  perform public.record_account_receipt(gen_random_uuid(),recipient,700,'cash');
  replay := public.create_account_reminder_batch(request);
  if replay <> initial then raise exception 'Retry changed original reminder recipients'; end if;
  if public.create_account_reminder_batch(gen_random_uuid())->>'targeted' is distinct from '0' then
    raise exception 'A settled player still received a new reminder';
  end if;
end;
$$;
select set_config('request.jwt.claim.sub','36560000-0000-0000-0000-000000000012',true);
do $$
begin
  if public.get_my_account_reminder() is not null then raise exception 'Credit player saw a notice'; end if;
  begin
    perform public.create_account_reminder_batch(gen_random_uuid());
    raise exception 'A player could send reminders';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select set_config('request.jwt.claim.sub','36560000-0000-0000-0000-000000000011',true);
do $$
begin
  if public.get_my_account_reminder()->>'id' is null
    or public.get_player_account()->>'balance_pence' is distinct from '0' then
    raise exception 'Reminder did not resolve alongside the current settled account';
  end if;
end;
$$;
reset role;
do $$
declare
  club constant uuid := '36560000-0000-0000-0000-000000000001';
  request constant uuid := '36560000-0000-0000-0000-000000000020';
  actor constant uuid := '36560000-0000-0000-0000-000000000010';
  lease jsonb;
begin
  if (select count(*) from public.account_reminder_notices where club_id=club) <> 1 then
    raise exception 'Repeated reminder wrote extra notices';
  end if;
  lease := public.claim_account_reminder_push(club,request,actor);
  if lease->>'claim_id' is null or public.claim_account_reminder_push(club,request,actor) is not null then
    raise exception 'Multiple workers claimed the same reminder';
  end if;
  perform public.finish_account_reminder_push(club,request,(lease->>'claim_id')::uuid,0,0);
  if public.claim_account_reminder_push(club,request,actor) is not null then
    raise exception 'Completed reminder was claimed again';
  end if;
  raise notice 'ALL ACCOUNT REMINDER TESTS PASSED';
end;
$$;
rollback;
