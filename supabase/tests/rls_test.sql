-- ============================================================================
-- Nottinghamshire MvF — RLS policy test harness  (rev: team-scoped availability)
-- ----------------------------------------------------------------------------
-- Two rules that are easy to confuse, and the harness pins both down:
--   SEEING a fixture is club-wide — the old eligibility gate went in 0023 and
--   stays gone, so everyone follows both teams.
--   ANSWERING one is team-scoped — 0034, after a Community-only player was
--   found marking himself in for First Team games.
-- It proves that split AND that neither change opened any OTHER access:
--   • a Community-only player now SEES First Team fixtures (gate gone)           [T2]
--   • …but CANNOT set availability on them — responding is team-scoped (0034)    [T3]
--   • …and CAN still answer their OWN squad's fixture                            [T3b]
--   • a Community-only ADMIN is refused too: no bypass on your own row (0034)    [T12]
--   • nobody can answer a fixture that has already kicked off (0034)             [T13]
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
-- means green. Run AFTER 0001…0034 + seed.
-- ============================================================================

begin;

-- Actors (club 1): uG admin, uA Community-only (approved), uB both teams (approved),
-- uP pending (NOT approved), uM a Community-only ADMIN. uC lives in a SECOND club.
-- NOTE (0034): the `teams` in raw_user_meta_data below are now only a REQUEST —
-- handle_new_user drops every signup into the reserves and squads are the
-- manager's to grant, so the memberships each actor needs are inserted by hand
-- further down, exactly as PlayerForm would write them.
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
   -- ASKS FOR THE FIRST TEAM. Post-0034 the trigger must ignore that and seed
   -- the reserves only; T14 leans on this actor, so don't quietly make it
   -- ["community"] again or the assertion goes vacuous.
   '{"first_name":"Pat","last_name":"Pending","phone":"07700900004","teams":["xl"]}'),
  ('00000000-0000-0000-0000-000000000000','a0000006-0000-0000-0000-000000000006','authenticated','authenticated',
   'resadmin@test.notts', crypt('p6', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}',
   '{"first_name":"Mo","last_name":"Reece","phone":"07700900006","teams":["community"]}');

-- Bootstrap the admins + approve the active players (postgres bypasses protect).
update profiles set role = 'admin', approved = true where id in ('a0000001-0000-0000-0000-000000000001','a0000006-0000-0000-0000-000000000006');
update profiles set approved = true where id in ('a0000002-0000-0000-0000-000000000002','a0000003-0000-0000-0000-000000000003');
-- uP (a0000004) deliberately left approved = false (pending).

-- Squads, granted by hand because the trigger no longer does it (0034). The
-- trigger has already put everyone in Community ('44444444'), so only the
-- First Team ('33333333') memberships need adding:
--   uG  admin, BOTH squads      — the real club manager's shape
--   uB  player, BOTH squads
--   uA  player, Community only  — the actor the reported bug was about
--   uM  ADMIN, Community only   — proves there is no admin bypass (T12)
insert into team_memberships (profile_id, team_id) values
  ('a0000001-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333'),
  ('a0000003-0000-0000-0000-000000000003','33333333-3333-3333-3333-333333333333')
on conflict do nothing;

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
  ('d0000003-0000-0000-0000-000000000003','b1111111-1111-1111-1111-111111111111','b2222222-2222-2222-2222-222222222222','b3333333-3333-3333-3333-333333333333','c0000003-0000-0000-0000-000000000003', current_date + 7, '13:00','Home','League','Their Ground'),
  -- A Community fixture already PLAYED, for the kickoff lock (T13). uB is in
  -- this squad, so a refusal can only be the kickoff term doing its job.
  ('d0000004-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','44444444-4444-4444-4444-444444444444','c0000001-0000-0000-0000-000000000001', current_date - 7, '11:00','Home','League','Forest Rec 3G');

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

-- T3 — …but CANNOT set availability on it. THE REPORTED BUG (0034): seeing a
-- First Team game is fine, answering for a squad you're not in is not. This
-- assertion is the inverse of what it asserted before 0034 and fails on the
-- old policy. Still acting as uA (Community-only) from T2.
do $$ declare blocked boolean := false; begin
  begin insert into availability (fixture_id, profile_id, status)
        values ('d0000001-0000-0000-0000-000000000001','a0000002-0000-0000-0000-000000000002','in');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'T3 FAIL: Community-only player set availability on a First Team fixture (team gate gone!)'; end if;
  raise notice 'T3 PASS: Community-only player blocked from answering a First Team fixture';
end $$;

-- T3b — …and the gate is not a blanket ban: the SAME player answers their OWN
-- squad's fixture fine. Deliberately still uA, so the actor stays put for T9
-- below (which relies on the act_as set back at T2).
do $$ begin
  insert into availability (fixture_id, profile_id, status)
  values ('d0000002-0000-0000-0000-000000000002','a0000002-0000-0000-0000-000000000002','in');
  raise notice 'T3b PASS: Community-only player CAN answer their own squad''s fixture';
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

-- T12 — the team gate has NO admin bypass on your own availability row (0034).
-- uM is a real admin but Community-only, so he is refused on the First Team
-- fixture exactly like uA was in T3 — and can still answer his own squad's.
-- Deliberately a sixth actor rather than stripping uG's First Team membership:
-- uG stands in for the real club manager, who IS in both squads, and every
-- other admin test should keep running against that shape.
reset role; select pg_temp.act_as('a0000006-0000-0000-0000-000000000006'); set local role authenticated;
do $$ declare blocked boolean := false; begin
  begin insert into availability (fixture_id, profile_id, status)
        values ('d0000001-0000-0000-0000-000000000001','a0000006-0000-0000-0000-000000000006','in');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'T12 FAIL: a Community-only ADMIN answered a First Team fixture (admin bypass leaked into the team gate)'; end if;
  insert into availability (fixture_id, profile_id, status)
  values ('d0000002-0000-0000-0000-000000000002','a0000006-0000-0000-0000-000000000006','in');
  raise notice 'T12 PASS: no admin bypass — Community-only admin blocked on First Team, fine on Community';
end $$;

-- T13 — nobody answers a game that has already kicked off (0034). uB is IN the
-- Community squad and approved and active, so the only thing left to refuse
-- him on d0000004 (played a week ago) is the kickoff term.
reset role; select pg_temp.act_as('a0000003-0000-0000-0000-000000000003'); set local role authenticated;
do $$ declare blocked boolean := false; begin
  begin insert into availability (fixture_id, profile_id, status)
        values ('d0000004-0000-0000-0000-000000000004','a0000003-0000-0000-0000-000000000003','in');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'T13 FAIL: a player answered a fixture that had already kicked off'; end if;
  -- …and the same player is fine on an upcoming fixture in the same squad,
  -- proving T13 caught the kickoff term and not something else.
  insert into availability (fixture_id, profile_id, status)
  values ('d0000002-0000-0000-0000-000000000002','a0000003-0000-0000-0000-000000000003','in');
  raise notice 'T13 PASS: availability shuts at kickoff, still open before it';
end $$;

-- T14 — squads are NOT self-service (0034). uP signed up ASKING FOR THE FIRST
-- TEAM and nothing has granted it since, so this is the back door itself: the
-- trigger must have given him the reserves only, recorded the ask as a request,
-- and left him with no way to answer a First Team game even once signed off.
-- Fails on the pre-0034 trigger, which granted whatever the metadata asked for.
reset role;
do $$ declare ft int; comm int; asked text[]; begin
  select count(*) into ft from team_memberships
   where profile_id = 'a0000004-0000-0000-0000-000000000004'
     and team_id = '33333333-3333-3333-3333-333333333333';
  if ft > 0 then raise exception 'T14 FAIL: signup metadata granted itself a First Team membership (self-service back door open)'; end if;

  select count(*) into comm from team_memberships
   where profile_id = 'a0000004-0000-0000-0000-000000000004'
     and team_id = '44444444-4444-4444-4444-444444444444';
  if comm <> 1 then raise exception 'T14 FAIL: signup did not land in the reserves (got % rows)', comm; end if;

  select requested_teams into asked from profiles where id = 'a0000004-0000-0000-0000-000000000004';
  if not ('xl' = any(asked)) then raise exception 'T14 FAIL: the requested squad was thrown away instead of recorded'; end if;

  -- …and the request alone buys nothing: even approved, he could not answer.
  if can_respond_to_fixture('d0000001-0000-0000-0000-000000000001','a0000004-0000-0000-0000-000000000004')
    then raise exception 'T14 FAIL: a self-requested squad let the player answer a First Team fixture'; end if;

  raise notice 'T14 PASS: signup records the squad REQUEST, grants the reserves only, and buys no access';
end $$;

reset role;
do $$ begin raise notice '================  ALL RLS TESTS PASSED  ================'; end $$;

rollback;
