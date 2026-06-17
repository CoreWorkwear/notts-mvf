-- Manager-selected line-ups: the real "who was picked/played" record, distinct
-- from availability. One row per (fixture, player); role = starting XI or sub.
-- This replaces the availability='in' proxy for appearances.
create table if not exists lineups (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references fixtures(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'start' check (role in ('start','sub')),
  position text,                 -- formation slot label, e.g. 'GK','LB','ST' (nullable for subs)
  slot int,                      -- formation slot index (pitch placement)
  created_at timestamptz not null default now(),
  unique (fixture_id, profile_id)
);
create index if not exists lineups_fixture_idx on lineups(fixture_id);

alter table lineups enable row level security;

-- Read: anyone who can see the fixture sees its named XI (same gate as availability).
drop policy if exists lineups_select on lineups;
create policy lineups_select on lineups for select to authenticated
  using (can_select_fixture(fixture_id, auth.uid()));

-- Write: club admins only, on their own club's fixtures.
drop policy if exists lineups_admin_write on lineups;
create policy lineups_admin_write on lineups for all to authenticated
  using (is_admin(auth.uid()) and exists (select 1 from fixtures fx where fx.id = fixture_id and fx.club_id = current_club_id()))
  with check (is_admin(auth.uid()) and exists (select 1 from fixtures fx where fx.id = fixture_id and fx.club_id = current_club_id()));

grant select, insert, update, delete on lineups to authenticated;
