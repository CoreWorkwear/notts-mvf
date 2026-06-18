-- ============================================================================
-- Migration 0028: §2 — per-competition registered squad.
-- A pure registration LIST. It does NOT gate fixture visibility or availability
-- (everyone in the club still sees and answers fixtures). Links competition +
-- player (+ season). Admin-write, club-scoped RLS. A BEFORE-INSERT guard fills
-- season_id from the competition and enforces the squad cap server-side (so it
-- can't be exceeded by a race or a rogue write).
-- ============================================================================
create table if not exists competition_squads (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references competitions(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  season_id uuid not null references seasons(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (competition_id, profile_id)
);
alter table competition_squads enable row level security;

drop policy if exists competition_squads_select on competition_squads;
create policy competition_squads_select on competition_squads for select to authenticated
  using (exists (select 1 from competitions c where c.id = competition_id and c.club_id = current_club_id()));

drop policy if exists competition_squads_admin_write on competition_squads;
create policy competition_squads_admin_write on competition_squads for all to authenticated
  using (is_admin(auth.uid()) and exists (select 1 from competitions c where c.id = competition_id and c.club_id = current_club_id()))
  with check (is_admin(auth.uid()) and exists (select 1 from competitions c where c.id = competition_id and c.club_id = current_club_id()));

grant select, insert, delete on competition_squads to authenticated;

create or replace function public.competition_squad_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_enabled boolean; v_limit int; v_season uuid; v_count int;
begin
  select squad_limit_enabled, squad_limit, season_id into v_enabled, v_limit, v_season
    from competitions where id = new.competition_id;
  new.season_id := v_season;  -- always mirror the competition's season
  if v_enabled and v_limit is not null then
    select count(*) into v_count from competition_squads where competition_id = new.competition_id;
    if v_count >= v_limit then
      raise exception 'Squad is full (% of % registered)', v_count, v_limit using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists competition_squad_guard on competition_squads;
create trigger competition_squad_guard before insert on competition_squads
  for each row execute function public.competition_squad_guard();
