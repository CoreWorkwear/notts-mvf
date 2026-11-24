begin;

create table public.club_fee_rates (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  category text not null check (category in ('first_team', 'community', 'training')),
  amount_pence integer not null check (amount_pence >= 0),
  effective_from date not null check (isfinite(effective_from)),
  recorded_by uuid not null,
  recorded_at timestamptz not null default now(),
  unique (club_id, category, effective_from)
);
alter table public.club_fee_rates enable row level security;
revoke all on public.club_fee_rates from public, anon, authenticated, service_role;
create trigger fee_rates_immutable before update or delete on public.club_fee_rates
  for each row execute function public.reject_financial_mutation();

-- Called inside the relevant RPC. Writes share the ledger's release lock.
create function public.payments_manager_club(p_write boolean) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  actor uuid := auth.uid();
  club uuid := public.current_club_id();
begin
  if club is null or not public.is_admin(actor) or not public.is_approved_member(actor) then
    raise exception 'Club accounts access refused' using errcode = '42501';
  end if;
  if p_write then
    perform pg_advisory_xact_lock(hashtextextended('payments:' || club::text, 0));
  end if;
  if not coalesce((select enabled from public.club_payments_release where club_id = club), false) then
    raise exception 'Club accounts are unavailable' using errcode = '42501';
  end if;
  return club;
end;
$$;

-- Match and training posting RPCs select this using their stored London
-- activity date and record the returned ID with the posted amount.
create function public.club_fee_rate_on(p_club uuid, p_category text, p_activity_date date)
returns public.club_fee_rates
language sql stable security definer set search_path = pg_catalog, public as $$
  select r from public.club_fee_rates r
  where r.club_id = p_club and r.category = p_category and r.effective_from <= p_activity_date
  order by r.effective_from desc
  limit 1;
$$;

create function public.get_club_fee_rates()
returns table (category text, current_rate jsonb, next_rate jsonb)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  club uuid := public.payments_manager_club(false);
  today date := (now() at time zone 'Europe/London')::date;
begin
  return query
  select kinds.category,
    (select jsonb_build_object('amount_pence', r.amount_pence, 'effective_from', r.effective_from)
     from public.club_fee_rate_on(club, kinds.category, today) r where r.id is not null),
    (select jsonb_build_object('amount_pence', r.amount_pence, 'effective_from', r.effective_from)
     from public.club_fee_rates r
     where r.club_id = club and r.category = kinds.category and r.effective_from > today
     order by r.effective_from limit 1)
  from (values ('first_team'), ('community'), ('training')) kinds(category);
end;
$$;

create function public.set_club_fee_rate(p_category text, p_amount_pence integer, p_effective_from date)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  club uuid := public.payments_manager_club(true);
  rate public.club_fee_rates;
begin
  if p_category is null or p_category not in ('first_team', 'community', 'training')
    or p_amount_pence is null or p_amount_pence < 0
    or p_effective_from is null or not isfinite(p_effective_from) then
    raise exception 'Enter a valid amount and effective date' using errcode = '22023';
  end if;
  select * into rate from public.club_fee_rates
    where club_id = club and category = p_category and effective_from = p_effective_from;
  if found then
    if rate.amount_pence = p_amount_pence then return rate.id; end if;
    raise exception 'A different amount is already set for this start date' using errcode = '23505';
  end if;
  insert into public.club_fee_rates (club_id, category, amount_pence, effective_from, recorded_by)
    values (club, p_category, p_amount_pence, p_effective_from, auth.uid())
    returning * into rate;
  return rate.id;
end;
$$;

revoke all on function public.payments_manager_club(boolean),
  public.club_fee_rate_on(uuid,text,date), public.get_club_fee_rates(),
  public.set_club_fee_rate(text,integer,date) from public, anon, authenticated, service_role;
grant execute on function public.get_club_fee_rates(), public.set_club_fee_rate(text,integer,date) to authenticated;

commit;
