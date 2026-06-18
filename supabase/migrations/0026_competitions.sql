-- ============================================================================
-- Migration 0026: §1.5 — competitions as a proper entity.
-- A competition is a named thing within a season (league / cup / friendly-series
-- / other), owned by a CLUB today but its OWN table with a NULLABLE owner so a
-- league can own it later without a rebuild (FUTURE-ARCHITECTURE §3/§7 — a paving
-- stone, NOT league structure). Carries the §2 squad-rule settings.
-- Club-scoped RLS; admin write. Fixtures + league tables link to a competition;
-- existing free-text league names are migrated into competition records.
-- ============================================================================
create table if not exists competitions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid references clubs(id) on delete cascade,            -- current owner; nullable for future league ownership
  season_id uuid not null references seasons(id) on delete cascade,
  name text not null,
  type text not null default 'league' check (type in ('league','cup','friendly_series','other')),
  squad_limit_enabled boolean not null default false,             -- §2
  squad_limit int check (squad_limit is null or squad_limit > 0), -- §2 (null = unlimited)
  created_at timestamptz not null default now()
);
alter table competitions enable row level security;
drop policy if exists competitions_select on competitions;
create policy competitions_select on competitions for select to authenticated
  using (club_id = current_club_id());
drop policy if exists competitions_admin_write on competitions;
create policy competitions_admin_write on competitions for all to authenticated
  using (club_id = current_club_id() and is_admin(auth.uid()))
  with check (club_id = current_club_id() and is_admin(auth.uid()));
grant select, insert, update, delete on competitions to authenticated;

-- Fixtures link to a competition (replacing free-text league_name). Friendly/cup
-- may be null. league_name kept for now as a display fallback during transition.
alter table fixtures add column if not exists competition_id uuid references competitions(id) on delete set null;

-- League tables become per competition (+ season).
alter table league_tables add column if not exists competition_id uuid references competitions(id) on delete cascade;

-- Migrate existing free-text league names → competition records, link fixtures.
do $$
declare r record; v_comp uuid;
begin
  for r in select distinct club_id, season_id, league_name from fixtures
           where league_name is not null and btrim(league_name) <> '' loop
    insert into competitions (club_id, season_id, name, type)
    values (r.club_id, r.season_id, r.league_name, 'league')
    returning id into v_comp;
    update fixtures set competition_id = v_comp
      where club_id = r.club_id and season_id = r.season_id and league_name = r.league_name;
  end loop;
end $$;
