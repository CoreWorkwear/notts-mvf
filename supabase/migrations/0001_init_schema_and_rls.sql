-- ============================================================================
-- Nottinghamshire MvF — Team Hub
-- Migration 0001: schema + helpers + triggers + Row-Level Security
-- ----------------------------------------------------------------------------
-- The spine of the app. RLS *is* the security (HANDOVER §4); the React UI only
-- mirrors these rules. The anon key is safe to ship because every rule below is
-- enforced at the database. Run this whole file in the Supabase SQL editor
-- (or via `supabase db push`). Then run seed.sql, then tests/rls_test.sql.
--
-- One club, two teams: XL 11s (first team, red) + Community (reserves, green).
-- Multi-tenant-ready: clubs as root, every owned row carries club_id.
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ----------------------------------------------------------------------------
-- 1. TABLES  (order respects FK dependencies)
-- ----------------------------------------------------------------------------

create table clubs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  crest_url   text,                                   -- real club badge (Storage)
  created_at  timestamptz not null default now()
);

create table seasons (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references clubs(id) on delete cascade,
  label       text not null,                          -- "2025/26"
  is_current  boolean not null default false
);

create table teams (
  id            uuid primary key default gen_random_uuid(),
  club_id       uuid not null references clubs(id) on delete cascade,
  key           text not null,                        -- 'xl' | 'community'
  label         text not null,                        -- 'XL 11s' | 'Community'
  is_first_team boolean not null default false,
  colour        text,                                 -- brand hex
  league_name   text,                                 -- default league for league fixtures
  unique (club_id, key)
);

-- 1:1 with auth.users. Created ONLY by the handle_new_user trigger.
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  club_id      uuid not null references clubs(id),
  first_name   text not null,                         -- REQUIRED
  last_name    text not null,                         -- REQUIRED
  email        text not null,                         -- REQUIRED (also the login)
  phone        text not null,                         -- REQUIRED
  dob          date,
  ec_name      text,                                  -- emergency contact
  ec_phone     text,
  positions    text[] not null default '{}',
  preferred    text,
  role         text not null default 'player' check (role in ('player','admin')),
  xl_eligible  boolean not null default false,
  active       boolean not null default true,         -- soft delete; kept for history
  photo_url    text,
  created_at   timestamptz not null default now()
);

create table team_memberships (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  team_id     uuid not null references teams(id) on delete cascade,
  unique (profile_id, team_id)
);

create table opponents (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references clubs(id) on delete cascade,
  name       text not null,
  badge_url  text                                     -- null = monogram fallback
);

create table media_assets (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references clubs(id) on delete cascade,
  type        text not null check (type in ('photo','crest','player_photo','opponent_badge')),
  url         text not null,                          -- Supabase Storage
  uploaded_by uuid references profiles(id),
  created_at  timestamptz not null default now()
);

create table fixtures (
  id              uuid primary key default gen_random_uuid(),
  club_id         uuid not null references clubs(id) on delete cascade,
  season_id       uuid not null references seasons(id),
  team_id         uuid not null references teams(id),
  opponent_id     uuid not null references opponents(id),
  match_date      date not null,
  kickoff         time not null,
  home_away       text not null default 'Home' check (home_away in ('Home','Away')),
  fixture_type    text not null default 'League' check (fixture_type in ('League','Friendly','Cup','Other')),
  league_name     text,                               -- only for League type; defaults from team
  venue           text not null,
  address         text,
  w3w             text,                               -- what3words "///a.b.c"
  pinned_image_id uuid references media_assets(id),   -- null = random club photo
  -- Weather (MVP §10): geocode venue once, cache forecast inside the window.
  venue_lat       numeric,
  venue_lng       numeric,
  forecast        jsonb,
  forecast_fetched_at timestamptz,
  created_at      timestamptz not null default now()
);

create table availability (
  id          uuid primary key default gen_random_uuid(),
  fixture_id  uuid not null references fixtures(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  status      text not null check (status in ('in','maybe','out')),
  updated_at  timestamptz not null default now(),
  unique (fixture_id, profile_id)
);

create table results (
  fixture_id      uuid primary key references fixtures(id) on delete cascade,
  ht_us           int not null default 0,
  ht_them         int not null default 0,
  us              int not null default 0,
  them            int not null default 0,
  motm_profile_id uuid references profiles(id),       -- nullable
  motm_name       text                                -- free-typed fallback
);

-- Our team's goals only; opposition is just the number on results.
-- Stats key by profile_id; *_name is the free-typed fallback for non-squad
-- (guests/trialists/own goals). HANDOVER §3 data-integrity note.
create table goals (
  id                 uuid primary key default gen_random_uuid(),
  fixture_id         uuid not null references fixtures(id) on delete cascade,
  scorer_profile_id  uuid references profiles(id),
  scorer_name        text,
  assist_profile_id  uuid references profiles(id),
  assist_name        text,
  minute             int
);

-- Fully manual; admin keeps it current from the league's own source.
create table league_tables (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references clubs(id) on delete cascade,
  season_id  uuid not null references seasons(id),
  team_id    uuid not null references teams(id),      -- which of our teams' division
  team_name  text not null,                           -- a row in the standings (incl. ours)
  played     int not null default 0,
  won        int not null default 0,
  drawn      int not null default 0,
  lost       int not null default 0,
  gf         int not null default 0,
  ga         int not null default 0,
  pts        int not null default 0,
  gd         int generated always as (gf - ga) stored -- sort: pts, then gd, then gf
);

-- Subs: paid / not-paid per player per fixture (MVP §10). Own table so the
-- enhanced version (amounts, balances) grows in without a retrofit. £7/game.
create table payments (
  id          uuid primary key default gen_random_uuid(),
  fixture_id  uuid not null references fixtures(id) on delete cascade,
  profile_id  uuid not null references profiles(id),
  paid        boolean not null default false,
  unique (fixture_id, profile_id)
);

-- Push tokens (MVP infra §10). A table (not a profile column) for multi-device.
create table push_tokens (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  token       text not null,
  platform    text check (platform in ('android','ios','web')),
  created_at  timestamptz not null default now(),
  unique (profile_id, token)
);

-- Helpful indexes for the hot read paths.
create index on fixtures (club_id, season_id, team_id, match_date);
create index on availability (fixture_id);
create index on availability (profile_id);
create index on team_memberships (profile_id);
create index on team_memberships (team_id);
create index on goals (fixture_id);
create index on payments (fixture_id);

-- ----------------------------------------------------------------------------
-- 2. HELPER FUNCTIONS  (security definer where they must bypass RLS)
-- ----------------------------------------------------------------------------

-- True if uid is an active admin. SECURITY DEFINER so policies can call it
-- without recursing through the profiles RLS policy.
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = uid and role = 'admin' and active
  );
$$;

-- The caller's club_id. SECURITY DEFINER to avoid policy recursion.
create or replace function public.current_club_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select club_id from profiles where id = auth.uid();
$$;

-- Can this user SELECT (and therefore respond to) this fixture?
-- A player needs a matching team membership AND (team isn't XL OR they're
-- xl_eligible). Admins see everything. SECURITY DEFINER so the availability
-- policy can reuse it without tripping the fixtures policy. This single
-- function is the eligibility gate, used by both fixtures SELECT and
-- availability INSERT/UPDATE — one source of truth.
create or replace function public.can_select_fixture(_fixture_id uuid, _uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_admin(_uid) or exists (
    select 1
    from fixtures f
    join teams t              on t.id = f.team_id
    join team_memberships tm  on tm.team_id = f.team_id and tm.profile_id = _uid
    join profiles p           on p.id = _uid
    where f.id = _fixture_id
      and p.active
      and (t.key <> 'xl' or p.xl_eligible)
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. NEW-USER TRIGGER  (profile + memberships from signup metadata)
-- ----------------------------------------------------------------------------
-- On auth.users insert, create the profiles row and team_memberships from the
-- signup metadata. ALWAYS force role='player' and xl_eligible=false server-side
-- regardless of what the client sends (HANDOVER §3). Required fields come
-- straight from metadata; a missing one fails the NOT NULL and aborts signup —
-- which is exactly the DB-level "required" guarantee we want.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
  v_team_key text;
  v_team_id uuid;
  v_team_count int := 0;
begin
  -- Single seeded club for now (multi-tenant-ready: switch to metadata later).
  select id into v_club_id from clubs order by created_at limit 1;

  insert into profiles (
    id, club_id, first_name, last_name, email, phone,
    dob, positions, preferred, role, xl_eligible, active
  ) values (
    new.id,
    v_club_id,
    new.raw_user_meta_data->>'first_name',
    new.raw_user_meta_data->>'last_name',
    new.email,
    new.raw_user_meta_data->>'phone',
    nullif(new.raw_user_meta_data->>'dob','')::date,
    coalesce(
      (select array_agg(value) from jsonb_array_elements_text(new.raw_user_meta_data->'positions')),
      '{}'
    ),
    nullif(new.raw_user_meta_data->>'preferred',''),
    'player',     -- forced
    false,        -- forced
    true
  );

  -- Memberships from the teams[] keys in metadata, resolved within the club.
  for v_team_key in
    select value from jsonb_array_elements_text(new.raw_user_meta_data->'teams')
  loop
    select id into v_team_id from teams where club_id = v_club_id and key = v_team_key;
    if v_team_id is not null then
      insert into team_memberships (profile_id, team_id)
      values (new.id, v_team_id)
      on conflict do nothing;
      v_team_count := v_team_count + 1;
    end if;
  end loop;

  -- Safety net: a new lad with no valid team picked lands in Community.
  if v_team_count = 0 then
    select id into v_team_id from teams where club_id = v_club_id and key = 'community';
    if v_team_id is not null then
      insert into team_memberships (profile_id, team_id)
      values (new.id, v_team_id)
      on conflict do nothing;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 4. PROFILE COLUMN PROTECTION  (the "only admins promote" rule, at the DB)
-- ----------------------------------------------------------------------------
-- NOT security definer on purpose: we need current_user to reflect the REAL
-- caller role. Privileged backend roles (postgres in the SQL editor, the
-- service_role key, the auth admin) bypass — that's how the FIRST admin gets
-- bootstrapped by hand (HANDOVER §8.16). Everyone coming in as 'authenticated'
-- is constrained: non-admins can't touch role/xl_eligible/active/club_id, and
-- NOBODY can demote or deactivate themselves (lockout guard).
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('postgres','supabase_admin','service_role','supabase_auth_admin') then
    return new;   -- trusted backend / bootstrap path
  end if;

  if not is_admin(auth.uid()) then
    new.role        := old.role;
    new.xl_eligible := old.xl_eligible;
    new.active      := old.active;
    new.club_id     := old.club_id;
  end if;

  if new.id = auth.uid() then
    if old.role = 'admin' and new.role is distinct from old.role then
      raise exception 'You cannot change your own admin role';
    end if;
    if old.active = true and new.active = false then
      raise exception 'You cannot deactivate your own account';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_columns on profiles;
create trigger protect_profile_columns
  before update on profiles
  for each row execute function public.protect_profile_columns();

-- Keep availability.updated_at honest.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists touch_availability on availability;
create trigger touch_availability
  before update on availability
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 5. ROW-LEVEL SECURITY
-- ----------------------------------------------------------------------------
alter table clubs            enable row level security;
alter table seasons          enable row level security;
alter table teams            enable row level security;
alter table profiles         enable row level security;
alter table team_memberships enable row level security;
alter table opponents        enable row level security;
alter table media_assets     enable row level security;
alter table fixtures         enable row level security;
alter table availability     enable row level security;
alter table results          enable row level security;
alter table goals            enable row level security;
alter table league_tables    enable row level security;
alter table payments         enable row level security;
alter table push_tokens      enable row level security;

-- clubs -------------------------------------------------------------------
create policy clubs_select on clubs
  for select to authenticated
  using (id = current_club_id());
create policy clubs_admin_write on clubs
  for all to authenticated
  using (id = current_club_id() and is_admin(auth.uid()))
  with check (id = current_club_id() and is_admin(auth.uid()));

-- seasons -----------------------------------------------------------------
create policy seasons_select on seasons
  for select to authenticated
  using (club_id = current_club_id());
create policy seasons_admin_write on seasons
  for all to authenticated
  using (club_id = current_club_id() and is_admin(auth.uid()))
  with check (club_id = current_club_id() and is_admin(auth.uid()));

-- teams -------------------------------------------------------------------
create policy teams_select on teams
  for select to authenticated
  using (club_id = current_club_id());
create policy teams_admin_write on teams
  for all to authenticated
  using (club_id = current_club_id() and is_admin(auth.uid()))
  with check (club_id = current_club_id() and is_admin(auth.uid()));

-- profiles ----------------------------------------------------------------
-- SELECT: any authed member of the club (squad lists, who's-in, stats).
create policy profiles_select on profiles
  for select to authenticated
  using (club_id = current_club_id());
-- UPDATE: own row or an admin's. Column-level rules live in the trigger above.
create policy profiles_update on profiles
  for update to authenticated
  using (id = auth.uid() or is_admin(auth.uid()))
  with check (id = auth.uid() or is_admin(auth.uid()));
-- INSERT is via the handle_new_user trigger only (no client policy).
-- DELETE: none — players are deactivated (active=false), never deleted.

-- team_memberships --------------------------------------------------------
create policy memberships_select on team_memberships
  for select to authenticated
  using (auth.uid() is not null);
create policy memberships_admin_write on team_memberships
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

-- opponents ---------------------------------------------------------------
create policy opponents_select on opponents
  for select to authenticated
  using (club_id = current_club_id());
create policy opponents_admin_write on opponents
  for all to authenticated
  using (club_id = current_club_id() and is_admin(auth.uid()))
  with check (club_id = current_club_id() and is_admin(auth.uid()));

-- media_assets ------------------------------------------------------------
create policy media_select on media_assets
  for select to authenticated
  using (club_id = current_club_id());
create policy media_admin_write on media_assets
  for all to authenticated
  using (club_id = current_club_id() and is_admin(auth.uid()))
  with check (club_id = current_club_id() and is_admin(auth.uid()));

-- fixtures ----------------------------------------------------------------
-- The eligibility gate. Players see a fixture only via can_select_fixture
-- (team membership + XL eligibility); admins see all in their club.
create policy fixtures_select on fixtures
  for select to authenticated
  using (club_id = current_club_id() and can_select_fixture(id, auth.uid()));
create policy fixtures_admin_write on fixtures
  for all to authenticated
  using (club_id = current_club_id() and is_admin(auth.uid()))
  with check (club_id = current_club_id() and is_admin(auth.uid()));

-- availability ------------------------------------------------------------
-- SELECT: authed in club (who's-in is club-wide). Write: own row only AND only
-- for a fixture the user is allowed to see (re-using the eligibility gate, so a
-- non-eligible player can't mark themselves in for an XL game).
create policy availability_select on availability
  for select to authenticated
  using (exists (
    select 1 from fixtures f
    where f.id = availability.fixture_id and f.club_id = current_club_id()
  ));
create policy availability_insert on availability
  for insert to authenticated
  with check (
    profile_id = auth.uid()
    and can_select_fixture(fixture_id, auth.uid())
  );
create policy availability_update on availability
  for update to authenticated
  using (profile_id = auth.uid() and can_select_fixture(fixture_id, auth.uid()))
  with check (profile_id = auth.uid() and can_select_fixture(fixture_id, auth.uid()));
create policy availability_delete on availability
  for delete to authenticated
  using (profile_id = auth.uid() or is_admin(auth.uid()));

-- results -----------------------------------------------------------------
create policy results_select on results
  for select to authenticated
  using (exists (
    select 1 from fixtures f
    where f.id = results.fixture_id and f.club_id = current_club_id()
  ));
create policy results_admin_write on results
  for all to authenticated
  using (is_admin(auth.uid()) and exists (
    select 1 from fixtures f
    where f.id = results.fixture_id and f.club_id = current_club_id()
  ))
  with check (is_admin(auth.uid()) and exists (
    select 1 from fixtures f
    where f.id = results.fixture_id and f.club_id = current_club_id()
  ));

-- goals -------------------------------------------------------------------
create policy goals_select on goals
  for select to authenticated
  using (exists (
    select 1 from fixtures f
    where f.id = goals.fixture_id and f.club_id = current_club_id()
  ));
create policy goals_admin_write on goals
  for all to authenticated
  using (is_admin(auth.uid()) and exists (
    select 1 from fixtures f
    where f.id = goals.fixture_id and f.club_id = current_club_id()
  ))
  with check (is_admin(auth.uid()) and exists (
    select 1 from fixtures f
    where f.id = goals.fixture_id and f.club_id = current_club_id()
  ));

-- league_tables -----------------------------------------------------------
create policy league_tables_select on league_tables
  for select to authenticated
  using (club_id = current_club_id());
create policy league_tables_admin_write on league_tables
  for all to authenticated
  using (club_id = current_club_id() and is_admin(auth.uid()))
  with check (club_id = current_club_id() and is_admin(auth.uid()));

-- payments ----------------------------------------------------------------
create policy payments_select on payments
  for select to authenticated
  using (exists (
    select 1 from fixtures f
    where f.id = payments.fixture_id and f.club_id = current_club_id()
  ));
create policy payments_admin_write on payments
  for all to authenticated
  using (is_admin(auth.uid()) and exists (
    select 1 from fixtures f
    where f.id = payments.fixture_id and f.club_id = current_club_id()
  ))
  with check (is_admin(auth.uid()) and exists (
    select 1 from fixtures f
    where f.id = payments.fixture_id and f.club_id = current_club_id()
  ));

-- push_tokens -------------------------------------------------------------
create policy push_tokens_own on push_tokens
  for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 6. GRANTS
-- ----------------------------------------------------------------------------
-- anon gets NOTHING — the app requires a login; auth happens via GoTrue, not
-- table access. authenticated gets table privileges, then RLS filters the rows.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- ============================================================================
-- End migration 0001
-- ============================================================================
