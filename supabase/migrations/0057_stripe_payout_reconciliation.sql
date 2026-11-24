begin;

-- Provider facts only: none of these functions posts to the player ledger.
create table public.stripe_payouts (
 club_id uuid not null references public.clubs(id), platform_account_id text not null, livemode boolean not null,
 stripe_account_id text not null,payout_id text not null,amount_pence bigint not null,currency text not null,
 status text not null,arrival_on date not null,created_on date not null,automatic boolean not null,
 reconciliation_status text not null,paid_at timestamptz,failed_at timestamptz,failure_code text,
 provider_observed_at timestamptz not null,
 primary key(platform_account_id,livemode,stripe_account_id,payout_id),
 foreign key(club_id,platform_account_id,livemode) references public.club_stripe_connections(club_id,platform_account_id,livemode)
);
create table public.stripe_payout_events (
 platform_account_id text not null,livemode boolean not null,event_id text not null,club_id uuid not null references public.clubs(id),
 payout_id text not null,payload jsonb not null,result jsonb not null,recorded_at timestamptz not null default now(),
 primary key(platform_account_id,livemode,event_id)
);
create table public.stripe_payout_breakdowns (
 id uuid primary key default gen_random_uuid(),sequence bigint generated always as identity unique,
 club_id uuid not null references public.clubs(id),platform_account_id text not null,livemode boolean not null,
 stripe_account_id text not null,payout_id text not null,lines jsonb not null check(jsonb_typeof(lines)='array'),
 complete boolean not null,issues text[] not null,checked_by uuid not null,checked_at timestamptz not null default now(),
 foreign key(platform_account_id,livemode,stripe_account_id,payout_id) references public.stripe_payouts(platform_account_id,livemode,stripe_account_id,payout_id)
);
create index stripe_payouts_club_arrival on public.stripe_payouts(club_id,platform_account_id,livemode,arrival_on);
create index stripe_payout_breakdowns_latest on public.stripe_payout_breakdowns(platform_account_id,livemode,stripe_account_id,payout_id,sequence desc);
alter table public.stripe_payouts enable row level security;
alter table public.stripe_payout_events enable row level security;
alter table public.stripe_payout_breakdowns enable row level security;
revoke all on public.stripe_payouts,public.stripe_payout_events,public.stripe_payout_breakdowns from public,anon,authenticated,service_role;
grant select on public.stripe_payouts,public.stripe_payout_events,public.stripe_payout_breakdowns to service_role;
create trigger stripe_payout_events_immutable before update or delete on public.stripe_payout_events for each row execute function public.reject_financial_mutation();
create trigger stripe_payout_breakdowns_immutable before update or delete on public.stripe_payout_breakdowns for each row execute function public.reject_financial_mutation();

create function public.store_stripe_payout_fact(p_club uuid,p_platform text,p_live boolean,p_account text,p_payout jsonb,p_observed_at timestamptz,p_signed boolean)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare old public.stripe_payouts; pid text:=p_payout->>'id'; state text:=p_payout->>'status'; amount bigint;
begin
 if pid is null or pid !~ '^po_[A-Za-z0-9]+$' or p_payout->>'object' is distinct from 'payout'
  or jsonb_typeof(p_payout->'livemode') is distinct from 'boolean' or (p_payout->>'livemode')::boolean is distinct from p_live
  or coalesce(p_payout->>'amount','') !~ '^[0-9]+$' or coalesce(p_payout->>'currency','') !~ '^[a-z]{3}$'
  or state is null or state not in ('pending','in_transit','paid','failed','canceled')
  or jsonb_typeof(p_payout->'automatic') is distinct from 'boolean'
  or coalesce(p_payout->>'arrival_date','') !~ '^[0-9]+$' or coalesce(p_payout->>'created','') !~ '^[0-9]+$'
  or p_observed_at is null or not isfinite(p_observed_at) then
  raise exception 'Invalid Stripe payout facts' using errcode='22023';
 end if;
 amount:=(p_payout->>'amount')::bigint;
 if not exists(select 1 from public.club_stripe_connections c where c.club_id=p_club and c.platform_account_id=p_platform and c.livemode=p_live and c.stripe_account_id=p_account) then
  raise exception 'Stripe payout account scope mismatch' using errcode='42501'; end if;
 select * into old from public.stripe_payouts where platform_account_id=p_platform and livemode=p_live and stripe_account_id=p_account and payout_id=pid;
 if found and (old.club_id is distinct from p_club or old.amount_pence is distinct from amount or old.currency is distinct from p_payout->>'currency') then
  raise exception 'Stripe payout identity conflict' using errcode='22023'; end if;
 insert into public.stripe_payouts(club_id,platform_account_id,livemode,stripe_account_id,payout_id,amount_pence,currency,status,arrival_on,created_on,
  automatic,reconciliation_status,paid_at,failed_at,failure_code,provider_observed_at)
 values(p_club,p_platform,p_live,p_account,pid,amount,p_payout->>'currency',state,
  (to_timestamp((p_payout->>'arrival_date')::double precision) at time zone 'Europe/London')::date,
  (to_timestamp((p_payout->>'created')::double precision) at time zone 'Europe/London')::date,
  (p_payout->>'automatic')::boolean,coalesce(p_payout->>'reconciliation_status','unknown'),
  case when p_signed and state='paid' then p_observed_at end,case when p_signed and state='failed' then p_observed_at end,p_payout->>'failure_code',p_observed_at)
 on conflict(platform_account_id,livemode,stripe_account_id,payout_id) do update set
  -- A genuine later bank rejection must remain visible. An older paid event
  -- or a concurrent/stale GET can never make a failed payout appear received.
  status=case when stripe_payouts.status='failed' or excluded.status='failed' then 'failed'
   when stripe_payouts.status='paid' then 'paid' else excluded.status end,
  arrival_on=case when excluded.provider_observed_at>=stripe_payouts.provider_observed_at then excluded.arrival_on else stripe_payouts.arrival_on end,
  automatic=case when excluded.provider_observed_at>=stripe_payouts.provider_observed_at then excluded.automatic else stripe_payouts.automatic end,
  reconciliation_status=case when excluded.provider_observed_at>=stripe_payouts.provider_observed_at then excluded.reconciliation_status else stripe_payouts.reconciliation_status end,
  paid_at=coalesce(stripe_payouts.paid_at,excluded.paid_at),failed_at=coalesce(stripe_payouts.failed_at,excluded.failed_at),
  failure_code=coalesce(excluded.failure_code,stripe_payouts.failure_code),provider_observed_at=greatest(stripe_payouts.provider_observed_at,excluded.provider_observed_at);
end; $$;

create function public.record_stripe_payout_event(p_platform_account_id text,p_event jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare live boolean; connection public.club_stripe_connections; prior public.stripe_payout_events; obj jsonb:=p_event#>'{data,object}'; result jsonb; payload jsonb; saved_payload jsonb;
begin
 if p_platform_account_id is null or p_platform_account_id !~ '^acct_[A-Za-z0-9]+$' or coalesce(p_event->>'id','') !~ '^evt_[A-Za-z0-9]+$'
  or p_event->>'type' is null or p_event->>'type' not in ('payout.paid','payout.failed')
  or jsonb_typeof(p_event->'livemode') is distinct from 'boolean' or coalesce(p_event->>'created','') !~ '^[0-9]+$' then
  raise exception 'Invalid Stripe payout event' using errcode='22023'; end if;
 live:=(p_event->>'livemode')::boolean;
 payload:=jsonb_build_object('type',p_event->>'type','account',p_event->>'account','livemode',live,'created',p_event->'created','object',obj);
 if obj->>'status' is distinct from split_part(p_event->>'type','.',2) then raise exception 'Stripe payout event state mismatch' using errcode='22023'; end if;
 select * into connection from public.club_stripe_connections where platform_account_id=p_platform_account_id and livemode=live and stripe_account_id=p_event->>'account';
 if not found then return jsonb_build_object('outcome','ignored'); end if;
 perform pg_advisory_xact_lock(hashtextextended('payments:'||connection.club_id::text,0));
 select * into prior from public.stripe_payout_events where platform_account_id=p_platform_account_id and livemode=live and event_id=p_event->>'id';
 if found then
  saved_payload:=prior.payload;
  -- Delivery bookkeeping (for example pending_webhooks) may change on replay.
  -- Preserve compatibility with pre-freeze isolated snapshots stored verbatim.
  if saved_payload ? 'data' then
   saved_payload:=jsonb_build_object('type',saved_payload->>'type','account',saved_payload->>'account','livemode',saved_payload->'livemode',
    'created',saved_payload->'created','object',saved_payload#>'{data,object}');
  end if;
  if saved_payload is distinct from payload then raise exception 'Stripe payout event reference conflict' using errcode='22023'; end if;
  return prior.result;
 end if;
 perform public.store_stripe_payout_fact(connection.club_id,p_platform_account_id,live,connection.stripe_account_id,obj,
  to_timestamp((p_event->>'created')::double precision),true);
 result:=jsonb_build_object('outcome',obj->>'status','payout_id',obj->>'id');
 insert into public.stripe_payout_events(platform_account_id,livemode,event_id,club_id,payout_id,payload,result)
 values(p_platform_account_id,live,p_event->>'id',connection.club_id,obj->>'id',payload,result);
 return result;
end; $$;

-- Called after a manager-authorised, fully paginated connected-account GET.
-- Partial/provider-failed refreshes never replace the last persisted finding.
create function public.save_stripe_payout_breakdown(p_actor_id uuid,p_club_id uuid,p_platform_account_id text,p_livemode boolean,
 p_payout jsonb,p_lines jsonb,p_complete boolean,p_issues text[] default '{}')
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare account text; line jsonb; result uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('payments:'||p_club_id::text,0));
 if not exists(select 1 from public.profiles where id=p_actor_id and club_id=p_club_id and role='admin' and active and approved)
  or not coalesce((select enabled from public.club_payments_release where club_id=p_club_id),false) then
  raise exception 'Club payout access refused' using errcode='42501'; end if;
 select stripe_account_id into account from public.club_stripe_connections where club_id=p_club_id and platform_account_id=p_platform_account_id and livemode=p_livemode;
 if account is null then raise exception 'Club Stripe account is not connected' using errcode='22023'; end if;
 if jsonb_typeof(p_lines) is distinct from 'array' or p_complete is null or p_issues is null
  or (p_complete and not coalesce((p_payout->>'automatic')::boolean,false)) then
  raise exception 'Invalid Stripe payout breakdown' using errcode='22023'; end if;
 for line in select value from jsonb_array_elements(p_lines) loop
  if coalesce(line->>'balance_transaction_id','') !~ '^txn_[A-Za-z0-9]+$'
   or coalesce(line->>'amount_pence','') !~ '^-?[0-9]+$' or coalesce(line->>'fee_pence','') !~ '^-?[0-9]+$'
   or coalesce(line->>'net_pence','') !~ '^-?[0-9]+$' or coalesce(line->>'created','') !~ '^[0-9]+$'
   or coalesce(line->>'currency','') !~ '^[a-z]{3}$' or coalesce(length(line->>'type'),0)=0 then
   raise exception 'Invalid Stripe balance transaction facts' using errcode='22023'; end if;
 end loop;
 if jsonb_array_length(p_lines)<>(select count(distinct value->>'balance_transaction_id') from jsonb_array_elements(p_lines)) then
  raise exception 'Duplicate Stripe balance transactions' using errcode='22023'; end if;
 perform public.store_stripe_payout_fact(p_club_id,p_platform_account_id,p_livemode,account,p_payout,now(),false);
 insert into public.stripe_payout_breakdowns(club_id,platform_account_id,livemode,stripe_account_id,payout_id,lines,complete,issues,checked_by)
 values(p_club_id,p_platform_account_id,p_livemode,account,p_payout->>'id',p_lines,p_complete,p_issues,p_actor_id) returning id into result;
 return result;
end; $$;

create function public.stripe_payout_report_row(p_club uuid,p_platform text,p_live boolean,p_account text,p_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare payout public.stripe_payouts; run public.stripe_payout_breakdowns; summary jsonb; items jsonb;
 gross bigint; refunds bigint; fees bigint; other bigint; net bigint; unresolved bigint; issues text[];
begin
 select * into strict payout from public.stripe_payouts where club_id=p_club and platform_account_id=p_platform and livemode=p_live and stripe_account_id=p_account and payout_id=p_id;
 select * into run from public.stripe_payout_breakdowns where platform_account_id=p_platform and livemode=p_live and stripe_account_id=p_account and payout_id=p_id order by sequence desc limit 1;
 with raw as (
  select x.*,case when x.type in ('charge','payment') and x.amount_pence>0 then 'payment'
   when x.type in ('refund','payment_refund') and x.amount_pence<0 then 'refund'
   when x.type in ('refund_failure','payment_refund') and x.amount_pence>0 then 'refund_restore' when x.type='stripe_fee' then 'fee' else 'other' end kind
  from jsonb_to_recordset(coalesce(run.lines,'[]'::jsonb)) as x(balance_transaction_id text,created bigint,type text,reporting_category text,currency text,
   source_id text,payment_intent_id text,refund_id text,failure_balance_transaction_id text,amount_pence bigint,fee_pence bigint,net_pence bigint,issue text)
 ), linked as (
  select r.*,coalesce(p.receipt_entry_id,rp.receipt_entry_id) receipt_entry_id,e.id ledger_entry_id,a.player_name,
   coalesce(p.payment_intent_id,rp.payment_intent_id) receipt_reference,
   coalesce(r.issue,case when r.currency<>payout.currency or r.currency<>'gbp' then 'Unsupported transaction currency'
    when r.amount_pence-r.fee_pence<>r.net_pence then 'Provider amount, fee and net disagree'
    when r.kind='payment' and p.receipt_entry_id is null then 'Player receipt not settled or source not linked'
    when r.kind='payment' and p.amount_pence<>r.amount_pence then 'Gross amount differs from player receipt'
    when r.kind='refund' and f.refund_entry_id is null then 'Player refund not settled or source not linked'
    when r.kind='refund' and (f.amount_pence<>-r.amount_pence or (r.payment_intent_id is not null and f.payment_intent_id<>r.payment_intent_id)) then 'Refund differs from settled refund'
    when r.kind='refund_restore' and r.failure_balance_transaction_id is distinct from r.balance_transaction_id then 'Provider refund failure balance transaction not verified'
    when r.kind='refund_restore' and rf.reversal_entry_id is null then 'Player refund restoration not settled or source not linked'
    when r.kind='refund_restore' and (rf.amount_pence<>r.amount_pence or rf.original_refund_entry_id is distinct from f.refund_entry_id
     or (r.payment_intent_id is not null and rf.payment_intent_id<>r.payment_intent_id)
     or e.kind is distinct from 'reversal' or e.amount_pence is distinct from r.amount_pence or e.linked_entry_id is distinct from f.refund_entry_id) then 'Refund restoration differs from settled correction'
    when r.kind='other' then 'Other provider movement: '||r.type else null end) resolved_issue
  from raw r
  left join public.stripe_settled_payments p on r.kind='payment' and p.platform_account_id=p_platform and p.livemode=p_live and p.stripe_account_id=p_account and p.club_id=p_club and p.payment_intent_id=r.payment_intent_id
  left join public.stripe_settled_refunds f on r.kind in ('refund','refund_restore') and f.platform_account_id=p_platform and f.livemode=p_live and f.stripe_account_id=p_account and f.club_id=p_club and f.refund_id=r.refund_id
  left join public.stripe_refund_failures rf on r.kind='refund_restore' and rf.platform_account_id=p_platform and rf.livemode=p_live and rf.stripe_account_id=p_account and rf.club_id=p_club and rf.refund_id=r.refund_id
  left join public.stripe_settled_payments rp on rp.platform_account_id=f.platform_account_id and rp.livemode=f.livemode and rp.stripe_account_id=f.stripe_account_id and rp.payment_intent_id=f.payment_intent_id
  left join public.account_entries e on e.id=case when r.kind='refund_restore' then rf.reversal_entry_id else coalesce(p.receipt_entry_id,f.refund_entry_id) end
  left join public.player_accounts a on a.id=e.account_id and a.club_id=p_club
 ), details as (
  select l.*,case when kind='payment' then amount_pence else 0 end gross,
   case when kind in ('refund','refund_restore') then -amount_pence else 0 end refunds,
   case when kind='fee' then -amount_pence+fee_pence else fee_pence end fees,
   case when kind='other' then amount_pence else 0 end other
  from linked l
 )
 select coalesce(jsonb_agg(jsonb_build_object('balance_transaction_id',d.balance_transaction_id,
   'date',(to_timestamp(d.created) at time zone 'Europe/London')::date,'type',d.type,'reporting_category',d.reporting_category,
   'method','stripe','currency',d.currency,'source_id',d.source_id,'payment_intent_id',d.payment_intent_id,'refund_id',d.refund_id,'failure_balance_transaction_id',d.failure_balance_transaction_id,
   'receipt_entry_id',d.receipt_entry_id,'player_name',d.player_name,'receipt_reference',d.receipt_reference,
   'gross_pence',d.gross,'refunds_pence',d.refunds,'fee_pence',d.fees,'net_pence',d.net_pence,'linked',d.ledger_entry_id is not null,'issue',d.resolved_issue)
   order by d.created,d.balance_transaction_id),'[]'::jsonb),coalesce(sum(d.gross) filter(where d.currency=payout.currency),0),coalesce(sum(d.refunds) filter(where d.currency=payout.currency),0),coalesce(sum(d.fees) filter(where d.currency=payout.currency),0),coalesce(sum(d.other) filter(where d.currency=payout.currency),0),coalesce(sum(d.net_pence) filter(where d.currency=payout.currency),0),count(*) filter(where d.resolved_issue is not null)
 into items,gross,refunds,fees,other,net,unresolved from details d;
 issues:=coalesce(run.issues,'{}'::text[]);
 if payout.automatic then
  if run.id is null then issues:=array_append(issues,'Breakdown has not been refreshed'); end if;
  if not coalesce(run.complete,false) then issues:=array_append(issues,'Balance transaction pages are incomplete'); end if;
  if payout.reconciliation_status<>'completed' then issues:=array_append(issues,'Stripe reconciliation is not complete'); end if;
 else
  -- A manual payout has provider amount/status evidence, but Stripe cannot
  -- identify its component batch. Do not invent a full-amount discrepancy or
  -- repeat old cached automatic/manual warnings for this unavailable evidence.
  select coalesce(array_agg(note),'{}'::text[]) into issues from unnest(issues) note
   where note not in ('Manual payout components cannot be identified automatically','Stripe has not completed automatic payout reconciliation');
  issues:=array_append(issues,'Manual payout components cannot be identified automatically');
 end if;
 if payout.status<>'paid' then issues:=array_append(issues,'Payout is '||payout.status||'; it is not confirmed received'); end if;
 if payout.currency<>'gbp' then issues:=array_append(issues,'Unsupported payout currency'); end if;
 if unresolved>0 then issues:=array_append(issues,'Some balance movements remain unresolved'); end if;
 if payout.automatic and net<>payout.amount_pence then issues:=array_append(issues,'Component net differs from payout amount'); end if;
 summary:=jsonb_build_object('complete',coalesce(run.complete,false),'reconciled',cardinality(issues)=0,
  'issues',issues,'gross_pence',gross,'refunds_pence',refunds,'fees_pence',fees,'other_pence',other,
  'net_pence',net,'component_net_available',payout.automatic and run.id is not null,
  'difference_pence',case when payout.automatic then payout.amount_pence-net else null end,'unresolved_count',unresolved,'checked_at',run.checked_at);
 return jsonb_build_object('payout_id',payout.payout_id,'status',payout.status,'arrival_on',payout.arrival_on,'created_on',payout.created_on,
  'paid_on',(payout.paid_at at time zone 'Europe/London')::date,'failed_on',(payout.failed_at at time zone 'Europe/London')::date,
  'amount_pence',payout.amount_pence,'currency',payout.currency,'automatic',payout.automatic,
  'reconciliation_status',payout.reconciliation_status,'failure_code',payout.failure_code,'breakdown',summary,'lines',items);
end; $$;

create function public.get_stripe_payout_report(p_platform_account_id text,p_livemode boolean,p_from date,p_to date,p_payout_id text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare club uuid:=public.payments_manager_club(false); account text; payouts jsonb;
begin
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_from>p_to or p_platform_account_id is null or p_livemode is null then
  raise exception 'Enter a valid payout reporting period and mode' using errcode='22023'; end if;
 select stripe_account_id into account from public.club_stripe_connections where club_id=club and platform_account_id=p_platform_account_id and livemode=p_livemode;
 if p_payout_id is not null and not exists(select 1 from public.stripe_payouts where club_id=club and platform_account_id=p_platform_account_id and livemode=p_livemode and stripe_account_id=account and payout_id=p_payout_id) then
  raise exception 'Payout is outside this club account or has not been fetched' using errcode='42501'; end if;
 select coalesce(jsonb_agg(public.stripe_payout_report_row(club,p_platform_account_id,p_livemode,account,p.payout_id) order by p.arrival_on,p.payout_id),'[]'::jsonb) into payouts
 from public.stripe_payouts p where p.club_id=club and p.platform_account_id=p_platform_account_id and p.livemode=p_livemode and p.stripe_account_id=account
 and ((p_payout_id is null and p.arrival_on between p_from and p_to) or p.payout_id=p_payout_id);
 return jsonb_build_object('mode',case when p_livemode then 'live' else 'test' end,'from',p_from,'to',p_to,'connected',account is not null,'payouts',payouts);
end; $$;

revoke all on function public.store_stripe_payout_fact(uuid,text,boolean,text,jsonb,timestamptz,boolean),
 public.record_stripe_payout_event(text,jsonb),public.save_stripe_payout_breakdown(uuid,uuid,text,boolean,jsonb,jsonb,boolean,text[]),
 public.stripe_payout_report_row(uuid,text,boolean,text,text),public.get_stripe_payout_report(text,boolean,date,date,text) from public,anon,authenticated,service_role;
grant execute on function public.record_stripe_payout_event(text,jsonb),public.save_stripe_payout_breakdown(uuid,uuid,text,boolean,jsonb,jsonb,boolean,text[]) to service_role;
grant execute on function public.get_stripe_payout_report(text,boolean,date,date,text) to authenticated;
comment on table public.stripe_payout_breakdowns is 'Immutable provider reconciliation snapshots. Repeated reads link known PI/refund settlement facts dynamically. Never creates, amends or apportions player receipts.';
commit;
