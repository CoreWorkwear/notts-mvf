begin;

create table public.player_stripe_customers (
 club_id uuid not null references public.clubs(id),
 profile_id uuid not null,
 platform_account_id text not null,
 livemode boolean not null,
 stripe_account_id text not null,
 creation_id uuid not null default gen_random_uuid() unique,
 created_at timestamptz not null default now(),
 stripe_customer_id text check(stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
 primary key(club_id,profile_id,platform_account_id,livemode),
 foreign key(club_id,platform_account_id,livemode) references public.club_stripe_connections(club_id,platform_account_id,livemode),
 unique(platform_account_id,livemode,stripe_account_id,stripe_customer_id)
);
create table public.stripe_checkout_attempts (
 id uuid primary key,
 club_id uuid not null references public.clubs(id),
 profile_id uuid not null,
 player_account_id uuid not null references public.player_accounts(id),
 platform_account_id text not null,
 livemode boolean not null,
 stripe_account_id text not null,
 kind text not null check(kind in ('balance','top_up')),
 amount_pence integer not null check(amount_pence between 30 and 99999999),
 currency text not null default 'gbp' check(currency='gbp'),
 quoted_balance_pence bigint not null,
 club_name text not null,
 success_url text not null,
 cancel_url text not null,
 created_at timestamptz not null default now(),
 stripe_customer_id text,
 checkout_session_id text check(checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'),
 checkout_url text,
 payment_intent_id text,
 status text not null default 'creating' check(status in ('creating','pending','succeeded','failed','expired')),
 receipt_entry_id uuid references public.account_entries(id),
 foreign key(club_id,profile_id,platform_account_id,livemode) references public.player_stripe_customers(club_id,profile_id,platform_account_id,livemode),
 unique(platform_account_id,livemode,stripe_account_id,checkout_session_id)
);
alter table public.player_stripe_customers enable row level security;
alter table public.stripe_checkout_attempts enable row level security;
revoke all on public.player_stripe_customers,public.stripe_checkout_attempts from public,anon,authenticated,service_role;
grant select on public.player_stripe_customers,public.stripe_checkout_attempts to service_role;

create function public.stripe_player_quote(p_club_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare balance bigint;
begin
 if not exists(select 1 from public.profiles where id=p_actor_id and club_id=p_club_id and approved and active and is_player)
  or not coalesce((select enabled from public.club_payments_release where club_id=p_club_id),false) then
  raise exception 'Player payments access refused' using errcode='42501';
 end if;
 select coalesce(sum(e.amount_pence::bigint),0) into balance from public.account_entries e
 join public.player_accounts a on a.id=e.account_id where a.club_id=p_club_id and a.profile_id=p_actor_id;
 return jsonb_build_object('balance_pence',balance,'amount_pence',greatest(-balance,0),'currency','gbp','min_amount_pence',30);
end; $$;

create function public.reserve_stripe_checkout(p_attempt_id uuid,p_club_id uuid,p_actor_id uuid,p_platform_account_id text,
 p_livemode boolean,p_kind text,p_amount_pence integer,p_success_url text,p_cancel_url text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare quote jsonb; prior public.stripe_checkout_attempts; customer public.player_stripe_customers; player_account uuid;
 connection public.club_stripe_connections; club_name text;
begin
 perform pg_advisory_xact_lock(hashtextextended('payments:'||p_club_id::text,0));
 quote:=public.stripe_player_quote(p_club_id,p_actor_id);
 if p_attempt_id is null or p_kind is null or p_kind not in ('balance','top_up')
  or p_amount_pence is null or p_amount_pence not between 30 and 99999999 then
  raise exception 'Enter a supported whole-pence GBP amount' using errcode='22023';
 end if;
 select * into strict connection from public.club_stripe_connections
 where club_id=p_club_id and platform_account_id=p_platform_account_id and livemode=p_livemode and stripe_account_id is not null;
 select * into prior from public.stripe_checkout_attempts where id=p_attempt_id;
 if found then
  if prior.club_id is distinct from p_club_id or prior.profile_id is distinct from p_actor_id
   or prior.platform_account_id is distinct from p_platform_account_id or prior.livemode is distinct from p_livemode
   or prior.stripe_account_id is distinct from connection.stripe_account_id
   or prior.kind is distinct from p_kind or prior.amount_pence is distinct from p_amount_pence then
   raise exception 'Payment attempt reference already used' using errcode='22023';
  end if;
 else
  if (select count(*) from public.stripe_checkout_attempts where club_id=p_club_id and profile_id=p_actor_id
   and created_at>now()-interval '10 minutes')>=10 then
   raise exception 'Too many payment attempts. Try again later.' using errcode='22023';
  end if;
  if p_kind='balance' and p_amount_pence::bigint<>(quote->>'amount_pence')::bigint then
   return jsonb_build_object('stale',true,'quote',quote);
  end if;
  select name into strict club_name from public.clubs where id=p_club_id;
  -- Capture immutable player identity before a subsequent hard removal. Verified
  -- provider settlement must still post to this account when release is paused.
  insert into public.player_accounts(club_id,profile_id,player_name)
  select p_club_id,p_actor_id,concat_ws(' ',first_name,last_name) from public.profiles where id=p_actor_id and club_id=p_club_id
  on conflict(club_id,profile_id) do nothing;
  select id into strict player_account from public.player_accounts where club_id=p_club_id and profile_id=p_actor_id;
  insert into public.player_stripe_customers(club_id,profile_id,platform_account_id,livemode,stripe_account_id)
  values(p_club_id,p_actor_id,p_platform_account_id,p_livemode,connection.stripe_account_id)
  on conflict(club_id,profile_id,platform_account_id,livemode) do nothing;
  insert into public.stripe_checkout_attempts(id,club_id,profile_id,player_account_id,platform_account_id,livemode,stripe_account_id,
   kind,amount_pence,quoted_balance_pence,club_name,success_url,cancel_url)
  values(p_attempt_id,p_club_id,p_actor_id,player_account,p_platform_account_id,p_livemode,connection.stripe_account_id,
   p_kind,p_amount_pence,(quote->>'balance_pence')::bigint,club_name,p_success_url,p_cancel_url) returning * into prior;
 end if;
 select * into strict customer from public.player_stripe_customers where club_id=p_club_id and profile_id=p_actor_id
 and platform_account_id=p_platform_account_id and livemode=p_livemode;
 if customer.stripe_account_id is distinct from prior.stripe_account_id then
  raise exception 'Customer account scope mismatch' using errcode='22023';
 end if;
 return jsonb_build_object('attempt',to_jsonb(prior),'customer',to_jsonb(customer));
end; $$;

create function public.bind_stripe_player_customer(p_creation_id uuid,p_customer_id text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare customer public.player_stripe_customers;
begin
 select * into strict customer from public.player_stripe_customers where creation_id=p_creation_id for update;
 if p_customer_id is null or p_customer_id !~ '^cus_[A-Za-z0-9]+$'
  or (customer.stripe_customer_id is not null and customer.stripe_customer_id is distinct from p_customer_id) then
  raise exception 'Customer scope mismatch' using errcode='22023';
 end if;
 update public.player_stripe_customers set stripe_customer_id=p_customer_id where creation_id=p_creation_id;
end; $$;

create function public.bind_stripe_checkout_session(p_attempt_id uuid,p_customer_id text,p_session_id text,p_checkout_url text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare attempt public.stripe_checkout_attempts;
begin
 select * into strict attempt from public.stripe_checkout_attempts where id=p_attempt_id for update;
 if not exists(select 1 from public.player_stripe_customers c where c.club_id=attempt.club_id and c.profile_id=attempt.profile_id
  and c.platform_account_id=attempt.platform_account_id and c.livemode=attempt.livemode
  and c.stripe_account_id=attempt.stripe_account_id and c.stripe_customer_id=p_customer_id)
  or p_session_id is null or (attempt.checkout_session_id is not null and attempt.checkout_session_id is distinct from p_session_id) then
  raise exception 'Checkout session scope mismatch' using errcode='22023';
 end if;
 update public.stripe_checkout_attempts set stripe_customer_id=p_customer_id,checkout_session_id=p_session_id,
 checkout_url=p_checkout_url,status=case when status='creating' then 'pending' else status end where id=p_attempt_id;
end; $$;

revoke all on function public.stripe_player_quote(uuid,uuid),
 public.reserve_stripe_checkout(uuid,uuid,uuid,text,boolean,text,integer,text,text),
 public.bind_stripe_player_customer(uuid,text),public.bind_stripe_checkout_session(uuid,text,text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.stripe_player_quote(uuid,uuid),
 public.reserve_stripe_checkout(uuid,uuid,uuid,text,boolean,text,integer,text,text),
 public.bind_stripe_player_customer(uuid,text),public.bind_stripe_checkout_session(uuid,text,text,text) to service_role;
comment on table public.stripe_checkout_attempts is 'Immutable agreed own-player GBP quote and scoped provider identity. Only verified NOT-35 settlement may mark succeeded/post a receipt; redirects never credit the ledger.';
commit;
