-- ============================================================================
-- Nottinghamshire MvF — RLS policy test harness
-- ----------------------------------------------------------------------------
-- Proves the security spine BEFORE any frontend (HANDOVER §8.2):
--   "confirm a non-eligible player cannot select an XL fixture."
--
-- Three users:           the gaffer (admin), a Community-only lad (not XL),
--                        an XL lad (made eligible by the gaffer).
-- It impersonates each by setting the JWT claim + the `authenticated` role,
-- exactly as PostgREST does, so RLS runs for real.
--
-- Run in the Supabase SQL editor AFTER 0001 + seed. The whole thing runs in a
-- transaction that ROLLS BACK at the end — repeatable, leaves nothing behind.
-- Every check RAISES on failure; if it runs to "ALL RLS TESTS PASSED" you're green.
-- ============================================================================

begin;

-- Fixed UUIDs for the actors / fixtures so we can reference them as literals.
-- G = gaffer/admin, A = Community-only (not eligible), B = XL (made eligible)
--   uG a0000001-...  uA a0000002-...  uB a0000003-...
--   opponent b0000001-...  XL fixture c0000001-...  Community fixture c0000002-...

-- ----------------------------------------------------------------------------
-- Setup: create three auth users. The handle_new_user trigger builds their
-- profiles + team memberships from the signup metadata, forcing player/not-eligible.
-- ----------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at,
   raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000',
   'a0000001-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'gaffer@test.notts', crypt('test-pass-1', gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}',
   '{"first_name":"Scott","last_name":"Hall","phone":"07700900001","teams":["xl","community"],"positions":["CM"],"preferred":"CM"}'),
  ('00000000-0000-0000-0000-000000000000',
   'a0000002-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'reserve@test.notts', crypt('test-pass-2', gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}',
   '{"first_name":"Jordan","last_name":"Reece","phone":"07700900002","teams":["community"],"positions":["ST"],"preferred":"ST"}'),
  ('00000000-0000-0000-0000-000000000000',
   'a0000003-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'firstteam@test.notts', crypt('test-pass-3', gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}',
   '{"first_name":"Aaron","last_name":"Webb","phone":"07700900003","teams":["xl","community"],"positions":["CB"],"preferred":"CB"}');

-- The trigger should have created exactly three player profiles, none eligible.
do $$
begin
  if (select count(*) from profiles where id in (
        'a0000001-0000-0000-0000-000000000001',
        'a0000002-0000-0000-0000-000000000002',
        'a0000003-0000-0000-0000-000000000003')) <> 3 then
    raise exception 'SETUP FAIL: trigger did not create 3 profiles';
  end if;
  if exists (select 1 from profiles
             where id in ('a0000001-0000-0000-0000-000000000001',
                          'a0000002-0000-0000-0000-000000000002',
                          'a0000003-0000-0000-0000-000000000003')
               and (role <> 'player' or xl_eligible)) then
    raise exception 'SETUP FAIL: a new user was not forced to player/not-eligible';
  end if;
  -- Community-only lad must have exactly the Community membership.
  if exists (
    select 1 from team_memberships tm
    join teams t on t.id = tm.team_id
    where tm.profile_id = 'a0000002-0000-0000-0000-000000000002' and t.key = 'xl'
  ) then
    raise exception 'SETUP FAIL: Community-only lad got an XL membership';
  end if;
  raise notice 'setup: 3 players created, all player/not-eligible, memberships correct';
end $$;

-- Bootstrap the FIRST admin by hand (postgres bypasses the protect trigger —
-- this mirrors HANDOVER §8.16 "flip your role to admin once in the table editor").
update profiles set role = 'admin'
  where id = 'a0000001-0000-0000-0000-000000000001';

-- Seed an opponent + one XL fixture + one Community fixture (as postgres).
insert into opponents (id, club_id, name)
values ('b0000001-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'Carlton Town');

insert into fixtures (id, club_id, season_id, team_id, opponent_id,
                      match_date, kickoff, home_away, fixture_type, venue)
values
  ('c0000001-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222',
   '33333333-3333-3333-3333-333333333333',   -- XL team
   'b0000001-0000-0000-0000-000000000001',
   current_date + 7, '13:00', 'Home', 'League', 'Forest Rec 3G'),
  ('c0000002-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222',
   '44444444-4444-4444-4444-444444444444',   -- Community team
   'b0000001-0000-0000-0000-000000000001',
   current_date + 8, '11:00', 'Away', 'Friendly', 'Harvey Hadden 4G');

-- ----------------------------------------------------------------------------
-- TEST 1 — Admin can grant XL eligibility (proves admin write path + trigger
--          does NOT block admins).
-- ----------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims',
  '{"sub":"a0000001-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  update profiles set xl_eligible = true
    where id = 'a0000003-0000-0000-0000-000000000003';
  if not (select xl_eligible from profiles
          where id = 'a0000003-0000-0000-0000-000000000003') then
    raise exception 'TEST 1 FAIL: admin could not grant XL eligibility';
  end if;
  raise notice 'TEST 1 PASS: gaffer granted XL eligibility to the XL lad';
end $$;

-- ----------------------------------------------------------------------------
-- TEST 2 — A non-eligible Community-only player CANNOT see the XL fixture, and
--          CAN see the Community fixture. THE headline requirement.
-- ----------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims',
  '{"sub":"a0000002-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
-- Assert on the SPECIFIC seeded fixtures, not on a total count — the live DB
-- may already hold other Community fixtures this lad can legitimately see.
-- We ALSO print the exact list of fixtures RLS lets him receive, so you can
-- read it with your own eyes and confirm the seeded XL game is not in it.
do $$
declare xl_visible boolean; comm_visible boolean; r record;
begin
  raise notice '----- Fixtures the Community-only lad can actually SEE -----';
  for r in
    select f.id, t.key as team_key, t.label as team_label, o.name as opponent, f.match_date
    from fixtures f
    join teams t on t.id = f.team_id
    join opponents o on o.id = f.opponent_id
    order by f.match_date, t.label
  loop
    raise notice '  VISIBLE -> % v %   [team=% | id=%]', r.team_label, r.opponent, r.team_key, r.id;
  end loop;
  raise notice '-----------------------------------------------------------';

  select exists(select 1 from fixtures
                where id = 'c0000001-0000-0000-0000-000000000001') into xl_visible;
  select exists(select 1 from fixtures
                where id = 'c0000002-0000-0000-0000-000000000002') into comm_visible;
  raise notice 'Seeded XL fixture  (XL 11s v Carlton Town, id c0000001...) visible to him? %', xl_visible;
  raise notice 'Seeded Community   (Community v Carlton Town, id c0000002...) visible to him? %', comm_visible;

  if xl_visible then
    raise exception 'TEST 2 FAIL: Community-only lad can SEE the XL fixture';
  end if;
  if not comm_visible then
    raise exception 'TEST 2 FAIL: Community-only lad cannot see his own Community fixture';
  end if;
  raise notice 'TEST 2 PASS: XL fixture named above and ABSENT from his visible list; Community fixture present';
end $$;

-- ----------------------------------------------------------------------------
-- TEST 3 — That same player CANNOT set availability for the XL fixture
--          (RLS WITH CHECK on the write path), but CAN for the Community one.
-- ----------------------------------------------------------------------------
do $$
declare blocked boolean := false;
begin
  begin
    insert into availability (fixture_id, profile_id, status)
    values ('c0000001-0000-0000-0000-000000000001',
            'a0000002-0000-0000-0000-000000000002', 'in');
  exception when others then
    blocked := true;   -- expected: RLS rejects the write
  end;
  if not blocked then
    raise exception 'TEST 3 FAIL: Community-only lad set availability on an XL fixture';
  end if;

  insert into availability (fixture_id, profile_id, status)
  values ('c0000002-0000-0000-0000-000000000002',
          'a0000002-0000-0000-0000-000000000002', 'in');
  raise notice 'TEST 3 PASS: XL availability blocked, Community availability allowed';
end $$;

-- ----------------------------------------------------------------------------
-- TEST 4 — A player CANNOT self-promote: changing own role / xl_eligible is
--          silently reverted by the protect trigger (no privilege escalation).
-- ----------------------------------------------------------------------------
do $$
begin
  update profiles
     set role = 'admin', xl_eligible = true
   where id = 'a0000002-0000-0000-0000-000000000002';
  if (select role from profiles where id = 'a0000002-0000-0000-0000-000000000002') = 'admin'
     or (select xl_eligible from profiles where id = 'a0000002-0000-0000-0000-000000000002') then
    raise exception 'TEST 4 FAIL: player escalated their own role/eligibility';
  end if;
  raise notice 'TEST 4 PASS: player self-promotion reverted (still player, not eligible)';
end $$;

-- ----------------------------------------------------------------------------
-- TEST 5 — An eligible XL player CAN see both fixtures and set XL availability.
-- ----------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims',
  '{"sub":"a0000003-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
do $$
declare xl_visible boolean; comm_visible boolean;
begin
  select exists(select 1 from fixtures
                where id = 'c0000001-0000-0000-0000-000000000001') into xl_visible;
  select exists(select 1 from fixtures
                where id = 'c0000002-0000-0000-0000-000000000002') into comm_visible;
  if not (xl_visible and comm_visible) then
    raise exception 'TEST 5 FAIL: eligible XL lad cannot see both fixtures (xl=%, comm=%)', xl_visible, comm_visible;
  end if;
  insert into availability (fixture_id, profile_id, status)
  values ('c0000001-0000-0000-0000-000000000001',
          'a0000003-0000-0000-0000-000000000003', 'in');
  raise notice 'TEST 5 PASS: eligible XL lad sees both seeded fixtures and marked himself in for the XL game';
end $$;

-- ----------------------------------------------------------------------------
-- TEST 6 — Lockout guard: the gaffer CANNOT demote or deactivate himself.
-- ----------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims',
  '{"sub":"a0000001-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
declare blocked boolean;
begin
  blocked := false;
  begin
    update profiles set role = 'player'
      where id = 'a0000001-0000-0000-0000-000000000001';
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'TEST 6 FAIL: gaffer demoted himself'; end if;

  blocked := false;
  begin
    update profiles set active = false
      where id = 'a0000001-0000-0000-0000-000000000001';
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'TEST 6 FAIL: gaffer deactivated himself'; end if;

  raise notice 'TEST 6 PASS: self-demote and self-deactivate both blocked';
end $$;

-- ----------------------------------------------------------------------------
-- TEST 7 — A plain player CANNOT write admin-only data (fixtures).
-- ----------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims',
  '{"sub":"a0000002-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$
declare blocked boolean := false;
begin
  begin
    insert into fixtures (club_id, season_id, team_id, opponent_id,
                          match_date, kickoff, venue)
    values ('11111111-1111-1111-1111-111111111111',
            '22222222-2222-2222-2222-222222222222',
            '44444444-4444-4444-4444-444444444444',
            'b0000001-0000-0000-0000-000000000001',
            current_date + 14, '12:00', 'Somewhere');
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'TEST 7 FAIL: a player created a fixture'; end if;
  raise notice 'TEST 7 PASS: player cannot create fixtures (admin-only write enforced)';
end $$;

reset role;

do $$ begin raise notice '================  ALL RLS TESTS PASSED  ================'; end $$;

rollback;   -- leave the database exactly as it was
