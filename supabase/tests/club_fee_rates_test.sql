-- NOT-32. Run after 0045–0046 and seed on the disposable database.
begin;

insert into public.clubs (id, name) values
  ('30460000-0000-0000-0000-000000000001', 'Fees proof'),
  ('30460000-0000-0000-0000-000000000002', 'Other fees proof');
insert into auth.users (id, email, raw_user_meta_data) values
  ('30460000-0000-0000-0000-000000000010', 'fees-manager@example.invalid', '{"first_name":"Fees","last_name":"Manager","phone":"07700900016"}'),
  ('30460000-0000-0000-0000-000000000011', 'fees-player@example.invalid', '{"first_name":"Fees","last_name":"Player","phone":"07700900017"}'),
  ('30460000-0000-0000-0000-000000000012', 'fees-other-manager@example.invalid', '{"first_name":"Other","last_name":"Manager","phone":"07700900018"}');
update public.profiles set club_id='30460000-0000-0000-0000-000000000001', approved=true
  where id::text like '30460000-%';
update public.profiles set role='admin'
  where id in ('30460000-0000-0000-0000-000000000010','30460000-0000-0000-0000-000000000012');
update public.profiles set club_id='30460000-0000-0000-0000-000000000002'
  where id='30460000-0000-0000-0000-000000000012';
select public.set_club_payments_release('30460000-0000-0000-0000-000000000001', true, true);
select public.set_club_payments_release('30460000-0000-0000-0000-000000000002', true, true);

set local role authenticated;
select set_config('request.jwt.claim.sub','30460000-0000-0000-0000-000000000010', true);
do $$
declare
  today date := (now() at time zone 'Europe/London')::date;
  old_rate uuid;
  current_rate jsonb;
  next_rate jsonb;
begin
  old_rate := public.set_club_fee_rate('first_team', 700, today - 1);
  perform public.set_club_fee_rate('first_team', 1000, today + 1);
  if public.set_club_fee_rate('first_team', 700, today - 1) is distinct from old_rate then
    raise exception 'Identical retry must return the original rate';
  end if;
  begin
    perform public.set_club_fee_rate('first_team', 800, today - 1);
    raise exception 'A conflicting price on the same day was accepted';
  exception when unique_violation then null;
  end;
  begin
    perform public.set_club_fee_rate('training', -1, today);
    raise exception 'A negative rate was accepted';
  exception when invalid_parameter_value then null;
  end;
  select r.current_rate, r.next_rate into current_rate, next_rate
    from public.get_club_fee_rates() r where r.category='first_team';
  if (current_rate->>'amount_pence')::int is distinct from 700 or
    (next_rate->>'amount_pence')::int is distinct from 1000 then
    raise exception 'Current and next amounts were incorrect: %, %', current_rate, next_rate;
  end if;
  if (select count(*) from public.get_club_fee_rates()) <> 3 then
    raise exception 'All three categories should be shown';
  end if;
  begin
    perform amount_pence from public.club_fee_rates;
    raise exception 'Direct rate table access was accepted';
  exception when insufficient_privilege then null;
  end;
  perform public.set_club_fee_rate('community', 700, '2026-12-31');
  perform public.set_club_fee_rate('community', 1000, '2027-01-01');
end;
$$;

select set_config('request.jwt.claim.sub','30460000-0000-0000-0000-000000000012', true);
do $$
begin
  if exists (select 1 from public.get_club_fee_rates() r where r.current_rate is not null or r.next_rate is not null) then
    raise exception 'A manager read another club rate';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub','30460000-0000-0000-0000-000000000011', true);
do $$
begin
  begin
    perform public.get_club_fee_rates();
    raise exception 'A player read manager fee settings';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_club_fee_rate('training', 500, current_date);
    raise exception 'A player wrote a fee rate';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
do $$
declare
  club constant uuid := '30460000-0000-0000-0000-000000000001';
begin
  if (public.club_fee_rate_on(club,'community','2026-12-31')).amount_pence is distinct from 700
    or (public.club_fee_rate_on(club,'community','2027-01-01')).amount_pence is distinct from 1000 then
    raise exception 'Lookup did not use the activity date across New Year';
  end if;
  if (public.club_fee_rate_on(club,'community','2026-12-30')).id is not null then
    raise exception 'Lookup silently selected a future rate';
  end if;
  perform public.set_club_payments_release(club, false);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','30460000-0000-0000-0000-000000000010', true);
do $$
begin
  begin
    perform public.set_club_fee_rate('training', 400, current_date);
    raise exception 'A paused release accepted a changed rate';
  exception when insufficient_privilege then null;
  end;
  raise notice 'ALL CLUB FEE RATE TESTS PASSED';
end;
$$;
rollback;
