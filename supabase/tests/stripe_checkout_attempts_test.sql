-- NOT-34. Signed-in checkout storage proof. Synthetic records roll back.
begin;

insert into public.clubs(id,name) values ('34530000-0000-0000-0000-000000000001','Checkout proof club');
insert into auth.users (id,email,raw_user_meta_data) values
  ('34530000-0000-0000-0000-000000000010','stripe-qa-manager@example.invalid','{"first_name":"Test","last_name":"Manager","phone":"07700900011"}'),
  ('34530000-0000-0000-0000-000000000011','stripe-qa-player@example.invalid','{"first_name":"Test","last_name":"Player","phone":"07700900012"}');
update public.profiles set approved=true,club_id='34530000-0000-0000-0000-000000000001'
  where id in ('34530000-0000-0000-0000-000000000010','34530000-0000-0000-0000-000000000011');
update public.profiles set role='admin' where id='34530000-0000-0000-0000-000000000010';
select public.set_club_payments_release('34530000-0000-0000-0000-000000000001',true,true);

do $$
declare
  club constant uuid := '34530000-0000-0000-0000-000000000001';
  manager constant uuid := '34530000-0000-0000-0000-000000000010';
  player constant uuid := '34530000-0000-0000-0000-000000000011';
  first_id constant uuid := '34530000-0000-0000-0000-000000000021';
  second_id constant uuid := '34530000-0000-0000-0000-000000000022';
  platform constant text := 'acct_QaCheckoutPlatform';
  result jsonb;
  connection public.club_stripe_connections;
  customer_id uuid;
  callback constant text := 'http://localhost:4173/you';
begin
  connection := public.reserve_club_stripe_connection(club,platform,false,manager);
  perform public.save_club_stripe_connection(club,platform,false,connection.creation_id,
    'acct_QaCheckoutClub','{"charges_enabled":true,"payouts_enabled":true}');
  perform public.post_account_entry(jsonb_build_object(
    'club_id',club,'profile_id',player,'kind','opening','source','opening','source_id','qa-3453-opening',
    'amount_pence',-900,'description','Opening balance'));
  result := public.reserve_stripe_checkout(first_id,club,player,platform,false,'balance',900,callback,callback);
  if (result->'attempt'->>'amount_pence')::integer is distinct from 900 or
    (result->'attempt'->>'status') is distinct from 'creating' then
    raise exception 'Could not reserve the £9 quote';
  end if;
  customer_id := (result->'customer'->>'creation_id')::uuid;
  perform public.post_account_entry(jsonb_build_object(
    'club_id',club,'profile_id',player,'kind','receipt','source','bank','source_id','qa-3453-receipt',
    'amount_pence',900,'description','Bank transfer'));
  result := public.reserve_stripe_checkout(second_id,club,player,platform,false,'balance',900,callback,callback);
  if result->>'stale' is distinct from 'true' or result->'quote'->>'amount_pence' is distinct from '0' then
    raise exception 'A changed pay-balance quote was accepted';
  end if;
  if exists (select 1 from public.stripe_checkout_attempts where id=second_id) then
    raise exception 'A refused quote left a payment attempt';
  end if;
  result := public.reserve_stripe_checkout(first_id,club,player,platform,false,'balance',900,callback,callback);
  if result->'attempt'->>'id' is distinct from first_id::text
    or result->'customer'->>'creation_id' is distinct from customer_id::text then
    raise exception 'Exact retry lost the agreed attempt or customer';
  end if;
  perform public.bind_stripe_player_customer(customer_id,'cus_QaCheckoutPlayer');
  begin
    perform public.bind_stripe_checkout_session(first_id,'cus_OtherPlayer','cs_test_wrong',null);
    raise exception 'A different customer could bind the attempt';
  exception when invalid_parameter_value then null;
  end;
  perform public.bind_stripe_checkout_session(first_id,'cus_QaCheckoutPlayer','cs_test_checkoutproof',
    'https://checkout.stripe.com/pay/cs_test_checkoutproof');
  if (select status from public.stripe_checkout_attempts where id=first_id) is distinct from 'pending'
    or (select sum(amount_pence) from public.account_entries where club_id=club) is distinct from 0 then
    raise exception 'Session binding changed the player balance';
  end if;
  perform public.set_club_payments_release(club,false);
  begin
    perform public.reserve_stripe_checkout(second_id,club,player,platform,false,'top_up',500,callback,callback);
    raise exception 'Paused release accepted new checkout';
  exception when insufficient_privilege then null;
  end;
  raise notice 'ALL STRIPE CHECKOUT STORAGE TESTS PASSED';
end;
$$;

set local role authenticated;
do $$
begin
  begin
    perform 1 from public.stripe_checkout_attempts;
    raise exception 'Browser received direct attempt access';
  exception when insufficient_privilege then null;
  end;
end;
$$;
rollback;
