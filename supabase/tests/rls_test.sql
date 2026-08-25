-- ============================================================================
-- Nottinghamshire MvF — RLS policy test harness  (rev: eligibility gate removed)
-- ----------------------------------------------------------------------------
-- The XL eligibility / team-membership VISIBILITY gate has been removed (§1):
-- fixtures are now visible to any active member of the club. This harness proves
-- the NEW model AND that removing the gate opened no OTHER unintended access:
--   • a Community-only player now SEES First Team fixtures (gate gone)           [T2]
--   • …and CAN set availability on them (write gate gone)                        [T3]
--   • a PENDING (unapproved) player still CANNOT set availability (approval gate)[T4]
--   • a player still cannot self-promote (protect trigger)                       [T5]
--   • a DIFFERENT-club player still cannot see or write our fixtures (isolation) [T6]
--   • a plain player still cannot write admin-only data (fixtures)               [T7]
--   • the admin still cannot demote/deactivate himself (lockout guard)           [T8]
--   • a player cannot write availability AS someone else (own-row only)          [T9]
--   • §3 manager view is cosmetic: a non-admin is refused EVERY admin-only write  [T10]
--     (competitions, squad registration, promoting another player) regardless of UI
--   • PII split (0033): profile_private readable/writable ONLY by self or a       [T11]
--     same-club admin — a member sees nobody else's contact details
--   • the admin write path still works                                           [T1]
--
-- Impersonates each user by setting the JWT claim + `authenticated` role, exactly
-- as PostgREST does. Runs in a transaction that ROLLS BACK — repeatable, leaves
-- nothing behind. Every check RAISEs on failure; reaching "ALL RLS TESTS PASSED"
-- means green. Run AFTER 0001…0023 + seed.
-- ============================================================================

begin;

-- Actors (club 1): uG admin, uA Community-only (approved), uB both teams (approved),
-- uP pending (NOT approved). uC lives in a SECOND club.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000','a0000001-0000-0000-0000-000000000001','authenticated','authenticated',
   'gaffer@test.notts', crypt('p1', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}',
   '{"first_name":"Scott","last_name":"Hall","phone":"07700900001","teams":["xl","community"]}'),
  ('00000000-0000-0000-0000-000000000000','a0000002-0000-0000-0000-000000000002','authenticated','authenticated',
   'reserve@test.notts', crypt('p2', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}',
   '{"first_name":"Jordan","last_name":"Reece","phone":"07700900002","teams":["community"]}'),
  ('00000000-0000-0000-0000-000000000000','a0000003-0000-0000-0000-000000000003','authenticated','authenticated',
   'firstteam@test.notts', crypt('p3', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}',
   '{"first_name":"Aaron","last_name":"Webb","phone":"07700900003","teams":["xl","community"]}'),
  ('00000000-0000-0000-0000-000000000000','a0000004-0000-0000-0000-000000000004','authenticated','authenticated',
   'pending@test.notts', crypt('p4', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}',
   '{"first_name":"Pat","last_name":"Pending","phone":"07700900004","teams":["community"]}');

-- Bootstrap the admin + approve the active players (postgres bypasses protect).
update profiles set role = 'admin', approved = true where id = 'a0000001-0000-0000-0000-000000000001';
update profiles set approved = true where id in ('a0000002-0000-0000-0000-000000000002','a0000003-0000-0000-0000-000000000003');
-- uP (a0000004) deliberately left approved = false (pending).

-- A SECOND club, with its own player uC (created in club 1 by the trigger, then moved).
insert into clubs (id, name, created_at) values ('b1111111-1111-1111-1111-111111111111', 'Other FC', now() + interval '1 min');
insert into seasons (id, club_id, label, is_current) values ('b2222222-2222-2222-2222-222222222222','b1111111-1111-1111-1111-111111111111','2025/26', true);
insert into teams (id, club_id, key, label, is_first_team) values ('b3333333-3333-3333-3333-333333333333','b1111111-1111-1111-1111-111111111111','first','Other First', true);
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000','a0000005-0000-0000-0000-000000000005','authenticated','authenticated',
   'other@test.notts', crypt('p5', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}',
   '{"first_name":"Otto","last_name":"Else","phone":"07700900005","teams":["community"]}');
update profiles set club_id = 'b1111111-1111-1111-1111-111111111111', approved = true where id = 'a0000005-0000-0000-0000-000000000005';

-- Seed: opponent + a First Team fixture + a Community fixture (club 1), and one club-2 fixture.
insert into opponents (id, club_id, name) values ('c0000001-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Carlton Town');
insert into opponents (id, club_id, name) values ('c0000003-0000-0000-0000-000000000003','b1111111-1111-1111-1111-111111111111','Their Rivals');
insert into fixtures (id, club_id, season_id, team_id, opponent_id, match_date, kickoff, home_away, fixture_type, venue) values
  ('d0000001-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','c0000001-0000-0000-0000-000000000001', current_date + 7, '13:00','Home','League','Forest Rec 3G'),
  ('d0000002-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','44444444-4444-4444-4444-444444444444','c0000001-0000-0000-0000-000000000001', current_date + 8, '11:00','Away','Friendly','Harvey Hadden 4G'),
  ('d0000003-0000-0000-0000-000000000003','b1111111-1111-1111-1111-111111111111','b2222222-2222-2222-2222-222222222222','b3333333-3333-3333-3333-333333333333','c0000003-0000-0000-0000-000000000003', current_date + 7, '13:00','Home','League','Their Ground');

-- A competition (club 1), seeded as postgres so the §3 cosmetic-toggle test below
-- is blocked PURELY by RLS, not by a missing FK.
insert into competitions (id, club_id, season_id, name, type)
  values ('e0000001-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','County Cup','cup');

-- helper to impersonate
create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role','authenticated')::text, true);
end $$;

-- T1 — admin write path works (admin creates a fixture).
reset role; select pg_temp.act_as('a0000001-0000-0000-0000-000000000001'); set local role authenticated;
do $$ begin
  insert into fixtures (club_id, season_id, team_id, opponent_id, match_date, kickoff, venue)
  values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','c0000001-0000-0000-0000-000000000001', current_date + 20, '14:00','Admin Test Park');
  raise notice 'T1 PASS: admin can write fixtures';
end $$;

-- T2 — Community-only player NOW SEES the First Team fixture (gate removed).
reset role; select pg_temp.act_as('a0000002-0000-0000-0000-000000000002'); set local role authenticated;
do $$
declare ft boolean; comm boolean; r record;
begin
  raise notice '----- Fixtures the Community-only player can now SEE -----';
  for r in select f.id, t.label tl, o.name opp from fixtures f join teams t on t.id=f.team_id join opponents o on o.id=f.opponent_id
           where f.club_id='11111111-1111-1111-1111-111111111111' order by f.match_date loop
    raise notice '  VISIBLE -> % v %', r.tl, r.opp;
  end loop;
  select exists(select 1 from fixtures where id='d0000001-0000-0000-0000-000000000001') into ft;
  select exists(select 1 from fixtures where id='d0000002-0000-0000-0000-000000000002') into comm;
  if not ft then raise exception 'T2 FAIL: Community-only player still cannot see the First Team fixture (gate not removed)'; end if;
  if not comm then raise exception 'T2 FAIL: Community-only player cannot see the Community fixture'; end if;
  raise notice 'T2 PASS: Community-only player sees BOTH the First Team and Community fixtures';
end $$;

-- T3 — …and CAN set availability on the First Team fixture (write gate removed).
do $$ begin
  insert into availability (fixture_id, profile_id, status)
  values ('d0000001-0000-0000-0000-000000000001','a0000002-0000-0000-0000-000000000002','in');
  raise notice 'T3 PASS: Community-only player set availability on the First Team fixture';
end $$;

-- T9 — but CANNOT write availability AS another player (own-row only).
do $$ declare blocked boolean := false; begin
  begin insert into availability (fixture_id, profile_id, status)
        values ('d0000002-0000-0000-0000-000000000002','a0000003-0000-0000-0000-000000000003','in');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'T9 FAIL: player wrote availability as someone else'; end if;
  raise notice 'T9 PASS: cannot set availability on another player''s behalf';
end $$;

-- T5 — player cannot self-promote (protect trigger reverts).
do $$ begin
  update profiles set role='admin' where id='a0000002-0000-0000-0000-000000000002';
  if (select role from profiles where id='a0000002-0000-0000-0000-000000000002')='admin' then
    raise exception 'T5 FAIL: player escalated own role'; end if;
  raise notice 'T5 PASS: self-promotion reverted';
end $$;

-- T7 — plain player cannot write admin-only data (fixtures).
do $$ declare blocked boolean := false; begin
  begin insert into fixtures (club_id, season_id, team_id, opponent_id, match_date, kickoff, venue)
        values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','44444444-4444-4444-4444-444444444444','c0000001-0000-0000-0000-000000000001', current_date+14,'12:00','Nope');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'T7 FAIL: player created a fixture'; end if;
  raise notice 'T7 PASS: player cannot create fixtures';
end $$;

-- T4 — a PENDING (unapproved) player still CANNOT set availability (approval gate holds).
reset role; select pg_temp.act_as('a0000004-0000-0000-0000-000000000004'); set local role authenticated;
do $$ declare blocked boolean := false; begin
  begin insert into availability (fixture_id, profile_id, status)
        values ('d0000002-0000-0000-0000-000000000002','a0000004-0000-0000-0000-000000000004','in');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'T4 FAIL: a pending player set availability (approval gate gone!)'; end if;
  raise notice 'T4 PASS: pending player still blocked from availability';
end $$;

-- T6 — a DIFFERENT-club player cannot see or write our fixtures (isolation intact).
reset role; select pg_temp.act_as('a0000005-0000-0000-0000-000000000005'); set local role authenticated;
do $$ declare seen boolean; blocked boolean := false; begin
  select exists(select 1 from fixtures where id='d0000001-0000-0000-0000-000000000001') into seen;
  if seen then raise exception 'T6 FAIL: a different-club player can see our fixture'; end if;
  begin insert into availability (fixture_id, profile_id, status)
        values ('d0000001-0000-0000-0000-000000000001','a0000005-0000-0000-0000-000000000005','in');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'T6 FAIL: a different-club player wrote availability on our fixture'; end if;
  raise notice 'T6 PASS: cross-club isolation intact (cannot see or write another club''s fixtures)';
end $$;

-- T8 — admin cannot demote/deactivate himself (lockout guard).
reset role; select pg_temp.act_as('a0000001-0000-0000-0000-000000000001'); set local role authenticated;
do $$ declare blocked boolean; begin
  blocked := false;
  begin update profiles set role='player' where id='a0000001-0000-0000-0000-000000000001'; exception when others then blocked := true; end;
  if not blocked then raise exception 'T8 FAIL: admin demoted himself'; end if;
  blocked := false;
  begin update profiles set active=false where id='a0000001-0000-0000-0000-000000000001'; exception when others then blocked := true; end;
  if not blocked then raise exception 'T8 FAIL: admin deactivated himself'; end if;
  raise notice 'T8 PASS: admin self-demote and self-deactivate both blocked';
end $$;

-- T10 — §3 manager view is COSMETIC. The UI toggle only shows/hides buttons; it
-- grants no authority. Prove the DB refuses the full spread of admin-only writes
-- the toggle would reveal — even if a non-admin's client somehow rendered them.
-- Acting as the Community (non-admin) player throughout.
reset role; select pg_temp.act_as('a0000002-0000-0000-0000-000000000002'); set local role authenticated;
do $$ declare blocked boolean; begin
  -- (a) create a competition
  blocked := false;
  begin insert into competitions (club_id, season_id, name, type)
        values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Sneaky League','league');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'T10 FAIL: non-admin created a competition'; end if;

  -- (b) register a player into a competition squad
  blocked := false;
  begin insert into competition_squads (competition_id, profile_id, season_id)
        values ('e0000001-0000-0000-0000-000000000001','a0000002-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'T10 FAIL: non-admin registered a competition squad'; end if;

  -- (c) promote ANOTHER player to admin
  begin update profiles set role='admin' where id='a0000003-0000-0000-0000-000000000003'; exception when others then null; end;
  if (select role from profiles where id='a0000003-0000-0000-0000-000000000003')='admin' then
    raise exception 'T10 FAIL: non-admin promoted another player'; end if;

  raise notice 'T10 PASS: manager view is cosmetic — DB rejects every admin write from a non-admin';
end $$;

-- T11 — PII split (0033): profile_private is self-or-same-club-admin ONLY.
reset role; select pg_temp.act_as('a0000002-0000-0000-0000-000000000002'); set local role authenticated;
do $$ declare others int; mine int; begin
  -- (a) a member sees ONLY their own private row — nobody else's PII
  select count(*) into others from profile_private where profile_id <> 'a0000002-0000-0000-0000-000000000002';
  if others > 0 then raise exception 'T11 FAIL: member can read % other private row(s) (PII leak)', others; end if;
  select count(*) into mine from profile_private where profile_id = 'a0000002-0000-0000-0000-000000000002';
  if mine <> 1 then raise exception 'T11 FAIL: member cannot read their OWN private row'; end if;
  -- (b) a member's write against another player's private row must not land
  update profile_private set phone = '00000' where profile_id = 'a0000003-0000-0000-0000-000000000003';
end $$;
reset role; -- (b) verified as postgres: the sneaky update above changed nothing
do $$ declare ph text; begin
  select phone into ph from profile_private where profile_id = 'a0000003-0000-0000-0000-000000000003';
  if ph = '00000' then raise exception 'T11 FAIL: member updated another player''s private row'; end if;
end $$;
-- (c) the club's admin CAN read the squad's private rows (contact details are the job)
select pg_temp.act_as('a0000001-0000-0000-0000-000000000001'); set local role authenticated;
do $$ declare n int; leak int; begin
  select count(*) into n from profile_private where profile_id in
    ('a0000002-0000-0000-0000-000000000002','a0000003-0000-0000-0000-000000000003');
  if n <> 2 then raise exception 'T11 FAIL: admin cannot read the squad''s private rows (saw %)', n; end if;
  -- (d) …but NOT another club's (is_admin is global; the policy's club check gates it)
  select count(*) into leak from profile_private where profile_id = 'a0000005-0000-0000-0000-000000000005';
  if leak > 0 then raise exception 'T11 FAIL: an admin can read ANOTHER CLUB''s private rows'; end if;
  raise notice 'T11 PASS: PII is self-or-same-club-admin only';
end $$;

reset role;
do $$ begin raise notice '================  ALL RLS TESTS PASSED  ================'; end $$;

rollback;
