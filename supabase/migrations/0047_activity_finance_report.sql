begin;

-- Date filtering follows the ledger's stored Europe/London accounting date,
-- not UTC posted_at. A correction belongs to its own accounting period and
-- carries the original charge's category/activity, even after operational deletion.
create index account_entries_club_accounting_date on public.account_entries(club_id,occurred_on,sequence);

create function public.get_activity_finance_report(p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 club uuid:=public.payments_manager_club(false);
 report jsonb;
begin
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_from>p_to then
  raise exception 'Enter a valid inclusive reporting period' using errcode='22023';
 end if;
 with period_entries as materialized (
  select e.*,a.profile_id,a.player_name
  from public.account_entries e join public.player_accounts a on a.id=e.account_id and a.club_id=e.club_id
  where e.club_id=club and e.occurred_on between p_from and p_to
 ), charge_lines as (
  select e.id,e.sequence,e.kind,e.occurred_on,e.posted_at,e.profile_id,e.player_name,e.description,
   -e.amount_pence::bigint as amount_pence,e.linked_entry_id,
   coalesce(o.id,e.id) as original_charge_id,coalesce(o.occurred_on,e.occurred_on) as original_occurred_on,
   coalesce(o.category,e.category) as category,coalesce(o.activity_type,e.activity_type) as activity_type,
   coalesce(o.activity_id,e.activity_id) as activity_id,coalesce(o.activity_snapshot,e.activity_snapshot) as activity_snapshot
  from period_entries e left join public.account_entries o
   on o.id=e.linked_entry_id and o.club_id=e.club_id and o.account_id=e.account_id
  where e.kind='charge' or (e.kind='reversal' and o.kind='charge')
 ), category_reports as (
  select kinds.category,kinds.sort_order,
   count(*) filter(where l.kind='charge') as charge_count,
   count(*) filter(where l.kind='reversal') as correction_count,
   coalesce(sum(l.amount_pence) filter(where l.kind='charge'),0) as charges_pence,
   coalesce(sum(l.amount_pence) filter(where l.kind='reversal'),0) as corrections_pence,
   coalesce(sum(l.amount_pence),0) as net_charges_pence,
   coalesce(jsonb_agg(to_jsonb(l)-'sequence'-'category' order by l.occurred_on,l.sequence) filter(where l.id is not null),'[]'::jsonb) as entries
  from (values('first_team',1),('community',2),('training',3),('fines',4)) kinds(category,sort_order)
  left join charge_lines l on l.category=kinds.category
  group by kinds.category,kinds.sort_order
 ), receipt_lines as (
  select e.id,e.sequence,e.kind,
   case when r.id is not null then 'stripe'
    else case coalesce(o.source,e.source) when 'stripe_payment' then 'stripe' else coalesce(o.source,e.source) end end as method,
   e.occurred_on,e.posted_at,e.profile_id,e.player_name,e.description,e.reference,e.amount_pence::bigint,
   e.linked_entry_id,(r.id is not null) as reverses_refund,
   case when r.id is not null then r.id when o.kind='receipt' then o.id else e.id end as original_receipt_id
  from period_entries e left join public.account_entries o
   on o.id=e.linked_entry_id and o.club_id=e.club_id and o.account_id=e.account_id
  -- A verified failed refund restores its original debit. Follow the immutable
  -- refund to its Stripe receipt even when both precede this reporting period.
  left join public.account_entries r on e.kind='reversal' and o.kind='refund' and o.source='stripe_refund'
   and r.id=o.linked_entry_id and r.club_id=e.club_id and r.account_id=e.account_id
   and r.kind='receipt' and r.source='stripe_payment'
  where (e.kind='receipt' and e.source in ('stripe_payment','bank','cash'))
   or (e.kind in ('refund','reversal') and o.kind='receipt' and o.source in ('stripe_payment','bank','cash'))
   or (e.kind='reversal' and r.id is not null)
 ), receipt_methods as (
  select methods.method,methods.sort_order,
   count(*) filter(where l.kind='receipt') as receipt_count,
   coalesce(sum(l.amount_pence) filter(where l.kind='receipt'),0) as gross_pence,
   count(*) filter(where l.kind='refund') as refund_count,
   coalesce(sum(l.amount_pence) filter(where l.kind='refund' or l.reverses_refund),0) as refunds_pence,
   count(*) filter(where l.kind='reversal' and not l.reverses_refund) as reversal_count,
   coalesce(sum(l.amount_pence) filter(where l.kind='reversal' and not l.reverses_refund),0) as reversals_pence,
   coalesce(sum(l.amount_pence),0) as net_pence
  from (values('stripe',1),('bank',2),('cash',3)) methods(method,sort_order)
  left join receipt_lines l on l.method=methods.method
  group by methods.method,methods.sort_order
 )
 select jsonb_build_object('from',p_from,'to',p_to,
  'categories',(select jsonb_agg(to_jsonb(c)-'sort_order' order by c.sort_order) from category_reports c),
  'totals',(select jsonb_build_object('charge_count',sum(charge_count),'correction_count',sum(correction_count),
    'charges_pence',sum(charges_pence),'corrections_pence',sum(corrections_pence),'net_charges_pence',sum(net_charges_pence)) from category_reports),
  'receipts',(select jsonb_build_object('receipt_count',sum(receipt_count),'gross_pence',sum(gross_pence),
    'refund_count',sum(refund_count),'refunds_pence',sum(refunds_pence),
    'reversal_count',sum(reversal_count),'reversals_pence',sum(reversals_pence),'net_pence',sum(net_pence),
    'methods',(select jsonb_agg(to_jsonb(m)-'sort_order' order by m.sort_order) from receipt_methods m),
    'entries',(select coalesce(jsonb_agg(to_jsonb(l)-'sequence' order by l.occurred_on,l.sequence),'[]'::jsonb) from receipt_lines l))
   from receipt_methods)) into report;
 return report;
end; $$;

revoke all on function public.get_activity_finance_report(date,date) from public,anon,authenticated,service_role;
grant execute on function public.get_activity_finance_report(date,date) to authenticated;
comment on function public.get_activity_finance_report(date,date) is
 'Manager-only, release-gated, inclusive London accounting-date report. Activity charges use positive report signs, their linked reversals negative. Separate receipts retain ledger signs and identify refunds/reversals by original method. Never apportions collections or authorises management transfers.';
commit;
