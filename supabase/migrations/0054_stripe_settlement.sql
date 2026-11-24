begin;

-- Delivery completion, underlying payments and individual refunds are separate
-- identities. Fee/net/payout enrichment never alters these gross player entries.
create unique index stripe_checkout_attempts_payment_intent_unique
 on public.stripe_checkout_attempts(platform_account_id,livemode,stripe_account_id,payment_intent_id)
 where payment_intent_id is not null;
create table public.stripe_settled_payments (
 platform_account_id text not null,
 livemode boolean not null,
 stripe_account_id text not null,
 payment_intent_id text not null,
 attempt_id uuid not null unique references public.stripe_checkout_attempts(id),
 club_id uuid not null references public.clubs(id),
 amount_pence integer not null check(amount_pence>0),
 currency text not null check(currency='gbp'),
 receipt_entry_id uuid not null unique references public.account_entries(id),
 created_at timestamptz not null default now(),
 primary key(platform_account_id,livemode,stripe_account_id,payment_intent_id)
);
create table public.stripe_settled_refunds (
 platform_account_id text not null,
 livemode boolean not null,
 stripe_account_id text not null,
 refund_id text not null,
 payment_intent_id text not null,
 club_id uuid not null references public.clubs(id),
 amount_pence integer not null check(amount_pence>0),
 refund_entry_id uuid not null unique references public.account_entries(id),
 created_at timestamptz not null default now(),
 primary key(platform_account_id,livemode,stripe_account_id,refund_id),
 foreign key(platform_account_id,livemode,stripe_account_id,payment_intent_id)
 references public.stripe_settled_payments(platform_account_id,livemode,stripe_account_id,payment_intent_id)
);
-- Terminal provider refund outcomes are immutable facts even when failure
-- arrives before any debit. They suppress stale success and preserve the one
-- compensating credit when a previously posted refund subsequently fails.
create table public.stripe_refund_failures (
 platform_account_id text not null,
 livemode boolean not null,
 stripe_account_id text not null,
 refund_id text not null,
 payment_intent_id text not null,
 attempt_id uuid not null references public.stripe_checkout_attempts(id),
 club_id uuid not null references public.clubs(id),
 amount_pence integer not null check(amount_pence>0),
 original_refund_entry_id uuid references public.account_entries(id),
 reversal_entry_id uuid unique references public.account_entries(id),
 terminal_status text not null check(terminal_status in ('failed','canceled')),
 failure_reason text,
 event_id text not null,
 created_at timestamptz not null default now(),
 primary key(platform_account_id,livemode,stripe_account_id,refund_id),
 check((original_refund_entry_id is null)=(reversal_entry_id is null))
);
create table public.stripe_settlement_events (
 platform_account_id text not null,
 livemode boolean not null,
 event_id text not null,
 stripe_account_id text not null,
 club_id uuid not null references public.clubs(id),
 payload jsonb not null,
 result jsonb not null,
 completed_at timestamptz not null default now(),
 primary key(platform_account_id,livemode,event_id)
);
alter table public.stripe_settled_payments enable row level security;
alter table public.stripe_settled_refunds enable row level security;
alter table public.stripe_settlement_events enable row level security;
alter table public.stripe_refund_failures enable row level security;
revoke all on public.stripe_settled_payments,public.stripe_settled_refunds,public.stripe_settlement_events,public.stripe_refund_failures
 from public,anon,authenticated,service_role;
grant select on public.stripe_settled_payments,public.stripe_settled_refunds,public.stripe_settlement_events,public.stripe_refund_failures to service_role;
create trigger stripe_settled_payments_immutable before update or delete on public.stripe_settled_payments for each row execute function public.reject_financial_mutation();
create trigger stripe_settled_refunds_immutable before update or delete on public.stripe_settled_refunds for each row execute function public.reject_financial_mutation();
create trigger stripe_refund_failures_immutable before update or delete on public.stripe_refund_failures for each row execute function public.reject_financial_mutation();
create trigger stripe_settlement_events_immutable before update or delete on public.stripe_settlement_events for each row execute function public.reject_financial_mutation();

-- Service-only: the Edge caller MUST authenticate raw bytes and timestamp first.
-- Every financial detail is independently matched to our immutable reservation.
create function public.process_stripe_settlement_event(p_platform_account_id text,p_event jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 event_id text:=p_event->>'id'; event_type text:=p_event->>'type';
 account_id text:=p_event->>'account'; live boolean;
 obj jsonb:=p_event#>'{data,object}'; metadata jsonb; payload jsonb;
 attempt public.stripe_checkout_attempts;
 payment public.stripe_settled_payments;
 refund public.stripe_settled_refunds;
 failure public.stripe_refund_failures;
 original_refund public.account_entries;
 refund_reversal uuid; reversal_payload jsonb;
 prior public.stripe_settlement_events;
 customer_id text; expected_customer text; pi text; session_id text; refund_id text;
 amount integer; outcome text; receipt uuid; refund_entry uuid; result jsonb;
 is_refund boolean; successful boolean; accounting_date date;
begin
 if p_platform_account_id is null or p_platform_account_id !~ '^acct_[A-Za-z0-9]+$'
  or event_id is null or event_id !~ '^evt_[A-Za-z0-9]+$' or account_id is null or account_id !~ '^acct_[A-Za-z0-9]+$'
  or jsonb_typeof(p_event->'livemode') is distinct from 'boolean' or jsonb_typeof(obj) is distinct from 'object'
  or coalesce(p_event->>'created','') !~ '^[0-9]+$' then
  raise exception 'Invalid Stripe event envelope' using errcode='22023';
 end if;
 live:=(p_event->>'livemode')::boolean;
 accounting_date:=(to_timestamp((p_event->>'created')::double precision) at time zone 'Europe/London')::date;
 if not isfinite(accounting_date) then raise exception 'Invalid Stripe event date' using errcode='22023'; end if;
 if event_type is null or event_type not in ('payment_intent.succeeded','payment_intent.processing','payment_intent.payment_failed','payment_intent.canceled',
  'checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired',
  'refund.created','refund.updated','refund.failed') then
  return jsonb_build_object('event_id',event_id,'outcome','ignored');
 end if;
 is_refund:=event_type like 'refund.%';
 -- Stripe Refund has no livemode field. Its signed envelope and the exact
 -- original PI/account lookup below establish mode. If supplied, object mode
 -- must still be a matching boolean; payment/session objects require it.
 if not is_refund or obj ? 'livemode' then
  if jsonb_typeof(obj->'livemode') is distinct from 'boolean' then
   raise exception 'Stripe object mode mismatch' using errcode='22023';
  end if;
  if (obj->>'livemode')::boolean is distinct from live then
   raise exception 'Stripe object mode mismatch' using errcode='22023';
  end if;
 end if;
 payload:=jsonb_build_object('type',event_type,'account',account_id,'livemode',live,'object',obj);
 if is_refund then
  if obj->>'object' is distinct from 'refund' then raise exception 'Invalid Stripe refund object' using errcode='22023'; end if;
  pi:=case jsonb_typeof(obj->'payment_intent') when 'object' then obj#>>'{payment_intent,id}' else obj->>'payment_intent' end;
  -- Non-PaymentIntent legacy charges are unrelated to this app. An unresolved
  -- PI is deliberately retryable: a real refund may precede the success event.
  if pi is null then return jsonb_build_object('event_id',event_id,'outcome','ignored'); end if;
  refund_id:=obj->>'id';
  if pi !~ '^pi_[A-Za-z0-9]+$' or refund_id is null or refund_id !~ '^re_[A-Za-z0-9]+$'
   or coalesce(obj->>'amount','') !~ '^[0-9]+$' or obj->>'currency' is distinct from 'gbp' then
   raise exception 'Invalid Stripe refund details' using errcode='22023';
  end if;
  amount:=(obj->>'amount')::integer;
  if amount<=0 then raise exception 'Invalid Stripe refund amount' using errcode='22023'; end if;
  select * into attempt from public.stripe_checkout_attempts where platform_account_id=p_platform_account_id
   and livemode=live and stripe_account_id=account_id and payment_intent_id=pi;
  if not found then raise exception 'Original app payment is not bound yet' using errcode='P0002'; end if;
 else
  metadata:=obj->'metadata';
  if metadata is null or metadata='null'::jsonb then metadata:='{}'::jsonb; end if;
  if jsonb_typeof(metadata)<>'object' then raise exception 'Invalid Stripe metadata' using errcode='22023'; end if;
  if not metadata ?| array['club_id','profile_id','player_account_id','attempt_id','platform_account_id','provider_mode'] then
   return jsonb_build_object('event_id',event_id,'outcome','ignored');
  end if;
  if metadata->>'attempt_id' is null then raise exception 'App payment attempt is not bound yet' using errcode='P0002'; end if;
  select * into attempt from public.stripe_checkout_attempts where id=(metadata->>'attempt_id')::uuid;
  if not found then raise exception 'App payment attempt is not bound yet' using errcode='P0002'; end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('payments:'||attempt.club_id::text,0));
 select * into attempt from public.stripe_checkout_attempts where id=attempt.id for update;
 if attempt.platform_account_id is distinct from p_platform_account_id or attempt.livemode is distinct from live
  or attempt.stripe_account_id is distinct from account_id or not exists(select 1 from public.club_stripe_connections c
   where c.club_id=attempt.club_id and c.platform_account_id=p_platform_account_id and c.livemode=live and c.stripe_account_id=account_id)
  or not exists(select 1 from public.player_accounts a where a.id=attempt.player_account_id and a.club_id=attempt.club_id and a.profile_id=attempt.profile_id) then
  raise exception 'Stripe account scope mismatch' using errcode='22023';
 end if;
 select * into prior from public.stripe_settlement_events where platform_account_id=p_platform_account_id and livemode=live and stripe_settlement_events.event_id=(p_event->>'id');
 if found then
  if prior.payload is distinct from payload then raise exception 'Stripe event reference conflict' using errcode='22023'; end if;
  if is_refund then
   select * into failure from public.stripe_refund_failures where platform_account_id=p_platform_account_id and livemode=live
    and stripe_account_id=account_id and stripe_refund_failures.refund_id=(obj->>'id');
   if found then
    if failure.payment_intent_id is distinct from pi or failure.amount_pence is distinct from amount then
     raise exception 'Stripe refund failure reference conflict' using errcode='22023';
    end if;
    return jsonb_strip_nulls(jsonb_build_object('event_id',event_id,'outcome','failed','receipt_entry_id',attempt.receipt_entry_id,
     'refund_entry_id',failure.original_refund_entry_id,'refund_reversal_entry_id',failure.reversal_entry_id));
   end if;
  end if;
  -- Older code could have acknowledged this failed snapshot while retaining
  -- the debit. Replaying that exact terminal event must repair it atomically;
  -- keep the original completion receipt immutable as historical evidence.
  if not is_refund or coalesce(obj->>'status','') not in ('failed','canceled') then return prior.result; end if;
 end if;
 if is_refund then
  select * into payment from public.stripe_settled_payments where platform_account_id=p_platform_account_id and livemode=live
   and stripe_account_id=account_id and payment_intent_id=pi;
  select * into refund from public.stripe_settled_refunds where platform_account_id=p_platform_account_id and livemode=live
   and stripe_account_id=account_id and stripe_settled_refunds.refund_id=(obj->>'id');
  if refund.refund_entry_id is not null and (refund.payment_intent_id is distinct from pi or refund.amount_pence is distinct from amount) then
   raise exception 'Stripe refund reference conflict' using errcode='22023';
  end if;
  select * into failure from public.stripe_refund_failures where platform_account_id=p_platform_account_id and livemode=live
   and stripe_account_id=account_id and stripe_refund_failures.refund_id=(obj->>'id');
  if failure.refund_id is not null then
   if failure.payment_intent_id is distinct from pi or failure.amount_pence is distinct from amount then
    raise exception 'Stripe refund failure reference conflict' using errcode='22023';
   end if;
   refund_entry:=failure.original_refund_entry_id; refund_reversal:=failure.reversal_entry_id; outcome:='failed';
  elsif obj->>'status' in ('failed','canceled') then
   refund_entry:=refund.refund_entry_id;
   if refund_entry is not null then
    select e.* into original_refund from public.account_entries e where e.id=refund_entry and e.club_id=attempt.club_id
     and e.account_id=attempt.player_account_id and e.kind='refund' and e.source='stripe_refund'
     and e.amount_pence=-amount and e.linked_entry_id=payment.receipt_entry_id;
    if not found then raise exception 'Original Stripe refund entry mismatch' using errcode='22023'; end if;
    reversal_payload:=jsonb_build_object('club_id',attempt.club_id,'profile_id',attempt.profile_id,'kind','reversal','amount_pence',amount,
     'source','reversal','source_id','stripe-refund-failure:'||p_platform_account_id||':'||live::text||':'||account_id||':'||refund_id,
     'reference',refund_id,'description','Stripe refund failed','linked_entry_id',refund_entry,'occurred_on',accounting_date);
    -- Only this verified, scope-matched provider transition may undo a Stripe
    -- refund. The generic/manual writer still refuses such reversals. A single
    -- club transaction plus the ledger's one-reversal index makes this exact.
    insert into public.account_entries(account_id,club_id,kind,amount_pence,description,reference,category,activity_type,activity_id,
     activity_snapshot,linked_entry_id,actor_id,source,source_id,occurred_on,request_payload)
    values(original_refund.account_id,attempt.club_id,'reversal',amount,'Stripe refund failed',refund_id,original_refund.category,
     original_refund.activity_type,original_refund.activity_id,original_refund.activity_snapshot,refund_entry,null,'reversal',
     reversal_payload->>'source_id',accounting_date,reversal_payload) returning id into refund_reversal;
   end if;
   insert into public.stripe_refund_failures(platform_account_id,livemode,stripe_account_id,refund_id,payment_intent_id,attempt_id,
    club_id,amount_pence,original_refund_entry_id,reversal_entry_id,terminal_status,failure_reason,event_id)
   values(p_platform_account_id,live,account_id,refund_id,pi,attempt.id,attempt.club_id,amount,refund_entry,refund_reversal,
    obj->>'status',obj->>'failure_reason',event_id);
   outcome:='failed';
  elsif refund.refund_entry_id is not null then
   refund_entry:=refund.refund_entry_id; outcome:='refunded';
  elsif obj->>'status'='succeeded' then
   if payment.receipt_entry_id is null then raise exception 'Original payment success has not settled yet' using errcode='P0002'; end if;
   refund_entry:=public.post_account_entry(jsonb_build_object('club_id',attempt.club_id,'profile_id',attempt.profile_id,
    'kind','refund','amount_pence',-amount,'source','stripe_refund',
    'source_id',p_platform_account_id||':'||live::text||':'||account_id||':'||refund_id,'reference',refund_id,
    'description','Stripe refund','linked_entry_id',payment.receipt_entry_id,'occurred_on',accounting_date));
   insert into public.stripe_settled_refunds(platform_account_id,livemode,stripe_account_id,refund_id,payment_intent_id,club_id,amount_pence,refund_entry_id)
   values(p_platform_account_id,live,account_id,refund_id,pi,attempt.club_id,amount,refund_entry);
   outcome:='refunded';
  else
   outcome:='pending';
  end if;
  receipt:=payment.receipt_entry_id;
 else
  if metadata->>'club_id' is distinct from attempt.club_id::text or metadata->>'profile_id' is distinct from attempt.profile_id::text
   or metadata->>'player_account_id' is distinct from attempt.player_account_id::text or metadata->>'platform_account_id' is distinct from p_platform_account_id
   or metadata->>'provider_mode' is distinct from (case when live then 'live' else 'test' end) then
   raise exception 'Stripe payment metadata mismatch' using errcode='22023';
  end if;
  expected_customer:=coalesce(attempt.stripe_customer_id,(select c.stripe_customer_id from public.player_stripe_customers c
   where c.club_id=attempt.club_id and c.profile_id=attempt.profile_id and c.platform_account_id=p_platform_account_id and c.livemode=live and c.stripe_account_id=account_id));
  if expected_customer is null then raise exception 'App customer binding is not ready' using errcode='P0002'; end if;
  customer_id:=case jsonb_typeof(obj->'customer') when 'object' then obj#>>'{customer,id}' else obj->>'customer' end;
  if customer_id is distinct from expected_customer or obj->>'currency' is distinct from attempt.currency then
   raise exception 'Stripe customer or currency mismatch' using errcode='22023';
  end if;
  if event_type like 'checkout.session.%' then
   session_id:=obj->>'id';
   if obj->>'object' is distinct from 'checkout.session' or obj->>'mode' is distinct from 'payment'
    or session_id is null or session_id !~ '^cs_[A-Za-z0-9_]+$' or coalesce(obj->>'amount_total','') !~ '^[0-9]+$'
    or (obj->>'amount_total')::integer is distinct from attempt.amount_pence
    or (attempt.checkout_session_id is not null and attempt.checkout_session_id is distinct from session_id) then
    raise exception 'Stripe Checkout details mismatch' using errcode='22023';
   end if;
   pi:=case jsonb_typeof(obj->'payment_intent') when 'object' then obj#>>'{payment_intent,id}' else obj->>'payment_intent' end;
   successful:=event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded') and obj->>'payment_status'='paid';
   if event_type='checkout.session.async_payment_succeeded' and not coalesce(successful,false) then
    raise exception 'Stripe Checkout is not paid' using errcode='22023';
   end if;
   outcome:=case when successful then 'succeeded' when event_type='checkout.session.expired' then 'expired'
    when event_type='checkout.session.async_payment_failed' then 'failed' else 'pending' end;
  else
   if obj->>'object' is distinct from 'payment_intent' or coalesce(obj->>'amount','') !~ '^[0-9]+$'
    or (obj->>'amount')::integer is distinct from attempt.amount_pence then
    raise exception 'Stripe PaymentIntent details mismatch' using errcode='22023';
   end if;
   pi:=obj->>'id';
   successful:=event_type='payment_intent.succeeded';
   if successful and (obj->>'status' is distinct from 'succeeded' or coalesce(obj->>'amount_received','') !~ '^[0-9]+$'
    or (obj->>'amount_received')::integer is distinct from attempt.amount_pence) then
    raise exception 'Stripe PaymentIntent is not fully received' using errcode='22023';
   end if;
   outcome:=case when successful then 'succeeded' when event_type in ('payment_intent.payment_failed','payment_intent.canceled') then 'failed' else 'pending' end;
  end if;
  if (pi is not null and pi !~ '^pi_[A-Za-z0-9]+$') or (coalesce(successful,false) and pi is null)
   or (attempt.payment_intent_id is not null and pi is not null and attempt.payment_intent_id is distinct from pi) then
   raise exception 'Stripe PaymentIntent reference mismatch' using errcode='22023';
  end if;
  update public.stripe_checkout_attempts set payment_intent_id=coalesce(payment_intent_id,pi),
   checkout_session_id=coalesce(checkout_session_id,session_id),stripe_customer_id=coalesce(stripe_customer_id,expected_customer) where id=attempt.id;
  receipt:=attempt.receipt_entry_id;
  if coalesce(successful,false) then
   select * into payment from public.stripe_settled_payments where platform_account_id=p_platform_account_id and livemode=live
    and stripe_account_id=account_id and payment_intent_id=pi;
   if found then
    if payment.attempt_id is distinct from attempt.id or payment.amount_pence is distinct from attempt.amount_pence then
     raise exception 'Stripe payment reference conflict' using errcode='22023';
    end if;
    receipt:=payment.receipt_entry_id;
   else
    receipt:=public.post_account_entry(jsonb_build_object('club_id',attempt.club_id,'profile_id',attempt.profile_id,'kind','receipt',
     'amount_pence',attempt.amount_pence,'source','stripe_payment','source_id',p_platform_account_id||':'||live::text||':'||account_id||':'||pi,
     'reference',pi,'description','Stripe payment','occurred_on',accounting_date));
    insert into public.stripe_settled_payments(platform_account_id,livemode,stripe_account_id,payment_intent_id,attempt_id,club_id,amount_pence,currency,receipt_entry_id)
    values(p_platform_account_id,live,account_id,pi,attempt.id,attempt.club_id,attempt.amount_pence,attempt.currency,receipt);
   end if;
  end if;
  if receipt is not null then outcome:='succeeded'; end if;
  update public.stripe_checkout_attempts set status=outcome,receipt_entry_id=receipt where id=attempt.id;
 end if;
 result:=jsonb_strip_nulls(jsonb_build_object('event_id',event_id,'outcome',outcome,'receipt_entry_id',receipt,'refund_entry_id',refund_entry,'refund_reversal_entry_id',refund_reversal));
 if prior.event_id is null then
  insert into public.stripe_settlement_events(platform_account_id,livemode,event_id,stripe_account_id,club_id,payload,result)
  values(p_platform_account_id,live,event_id,account_id,attempt.club_id,payload,result);
 end if;
 return result;
end; $$;
revoke all on function public.process_stripe_settlement_event(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.process_stripe_settlement_event(text,jsonb) to service_role;
comment on function public.process_stripe_settlement_event(text,jsonb) is
 'Verified Connect webhook only: raw signature/timestamp is authenticated by Edge. Atomic gross receipt/refund, scoped event/PI/refund identities and attempt transition; late failure never undoes success. App identity/original not yet bound raises P0002 for provider retry. Terminal refund failure preserves its original debit, restores it once by linked provider reversal, and suppresses stale success. No release flag blocks genuine settlement/refund/correction. Fee/net enrichment is deliberately independent.';
commit;
