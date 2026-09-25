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
--   • 0034 UPDATE path: a stale First Team answer can be withdrawn, not changed  [T15]
--   • an INACTIVE player and a SUPPORTER are refused on availability             [T16]
--   • profiles has no email column any more (0033 landed)                        [T17]
-- 0035 (backend review hardening):
--   • rescheduling a fixture (date or kickoff) re-arms its reminders             [T18]
--   • team_memberships is club-scoped: another club's user reads 0 rows, and a   [T19]
--     club admin cannot write a membership into another club's team
--   • the security-definer helpers cannot be executed by anon                    [T20]
--   • competition_squad_guard takes a per-competition advisory lock + holds cap [T21]
--   • media_admin_update WITH CHECK is initplan-wrapped like everything else     [T22]
--   • profile_private.email is not self-editable (admin can still correct it)   [T23]
--   • profiles.photo_url only accepts this project's public media bucket        [T24]
--   • anonymise_and_delete_profile: service-role only, club-checked, ATOMIC      [T25]
-- 0037 (security audit / pen-test remediation):
--   • the TRIGGER functions are not callable as RPC by anon or authenticated   [T27]
--   • reminders_sent is closed by privilege as well as by RLS                  [T28]
--   • all five remaining image URL columns are pinned to the media bucket      [T29]
--   • profiles_update is club-scoped; nobody moves their own account clubs     [T30]
--   • availability_delete cannot cross a club boundary                         [T31]
--
-- Impersonates each user by setting the JWT claim + `authenticated` role, exactly
-- as PostgREST does. Runs in a transaction that ROLLS BACK — repeatable, leaves
-- nothing behind. Every check RAISEs on failure; reaching "ALL RLS TESTS PASSED"
-- means green. Run AFTER 0001…0037 + seed.
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

-- T15 — the 0034 UPDATE path. T3 proves INSERT; this proves the UPDATE policy's
-- WITH CHECK carries the same team + kickoff terms. A stale First Team answer
-- is seeded as postgres — exactly the shape of the pre-0034 production rows —
-- for uA, who is Community-only. He must NOT be able to change it (the USING
-- half is own-row + active-player, which he passes, so only WITH CHECK can
-- refuse him) but MUST still be able to withdraw it: availability_delete is
-- own-row-or-admin on purpose (0034 §3).
reset role;
insert into availability (fixture_id, profile_id, status)
  values ('d0000001-0000-0000-0000-000000000001','a0000002-0000-0000-0000-000000000002','in');
select pg_temp.act_as('a0000002-0000-0000-0000-000000000002'); set local role authenticated;
do $$ declare blocked boolean := false; st text; n int; begin
  begin
    update availability set status = 'out'
     where fixture_id = 'd0000001-0000-0000-0000-000000000001'
       and profile_id = 'a0000002-0000-0000-0000-000000000002';
  exception when others then blocked := true; end;
  if not blocked then raise exception 'T15 FAIL: Community-only player CHANGED a pre-existing First Team answer (UPDATE WITH CHECK is missing the team gate)'; end if;
  select status into st from availability
   where fixture_id = 'd0000001-0000-0000-0000-000000000001' and profile_id = 'a0000002-0000-0000-0000-000000000002';
  if st is distinct from 'in' then raise exception 'T15 FAIL: the stale answer was altered anyway (now %)', st; end if;
  -- …but withdrawing it still works
  delete from availability
   where fixture_id = 'd0000001-0000-0000-0000-000000000001' and profile_id = 'a0000002-0000-0000-0000-000000000002';
  select count(*) into n from availability
   where fixture_id = 'd0000001-0000-0000-0000-000000000001' and profile_id = 'a0000002-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'T15 FAIL: player could not withdraw their stale First Team answer (delete must stay open)'; end if;
  raise notice 'T15 PASS: a stale out-of-squad answer cannot be changed, but can be withdrawn';
end $$;

-- T16 — is_active_player() has three legs (approved, active, is_player) and T4
-- only proves the first. Two more actors, both in the Community squad like uA
-- so the squad and kickoff terms PASS and the only thing left to refuse them on
-- d0000002 is the leg under test:
--   uI  approved, but active = false  (soft-removed player)
--   uS  approved, active, but a SUPPORTER (is_player = false)
reset role;
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000','a0000007-0000-0000-0000-000000000007','authenticated','authenticated',
   'inactive@test.notts', crypt('p7', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}',
   '{"first_name":"Ian","last_name":"Inactive","phone":"07700900007","teams":["community"]}'),
  ('00000000-0000-0000-0000-000000000000','a0000008-0000-0000-0000-000000000008','authenticated','authenticated',
   'fan@test.notts', crypt('p8', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}',
   '{"first_name":"Sam","last_name":"Supporter","phone":"07700900008","is_player":false}');
update profiles set approved = true, active = false where id = 'a0000007-0000-0000-0000-000000000007';
update profiles set approved = true where id = 'a0000008-0000-0000-0000-000000000008';
-- The trigger seeds no squad for a supporter; give uS the reserves by hand so
-- membership is NOT the reason he is refused.
insert into team_memberships (profile_id, team_id)
  values ('a0000008-0000-0000-0000-000000000008','44444444-4444-4444-4444-444444444444')
on conflict do nothing;
select pg_temp.act_as('a0000007-0000-0000-0000-000000000007'); set local role authenticated;
do $$ declare blocked boolean := false; begin
  begin insert into availability (fixture_id, profile_id, status)
        values ('d0000002-0000-0000-0000-000000000002','a0000007-0000-0000-0000-000000000007','in');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'T16 FAIL: an INACTIVE (active=false) player set availability'; end if;
end $$;
reset role; select pg_temp.act_as('a0000008-0000-0000-0000-000000000008'); set local role authenticated;
do $$ declare blocked boolean := false; begin
  begin insert into availability (fixture_id, profile_id, status)
        values ('d0000002-0000-0000-0000-000000000002','a0000008-0000-0000-0000-000000000008','in');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'T16 FAIL: a SUPPORTER (is_player=false) set availability'; end if;
  raise notice 'T16 PASS: inactive player and supporter both refused on availability (all three is_active_player legs hold)';
end $$;

-- T17 — 0033 landed: profiles has no email column (the PII lives in
-- profile_private, and every harness actor has a row there). Uses EXECUTE so
-- the missing column is a catchable runtime error, not a compile failure.
reset role;
do $$ declare gone boolean := false; missing int; begin
  begin execute 'select email from profiles limit 1';
  exception when undefined_column then gone := true; end;
  if not gone then raise exception 'T17 FAIL: profiles still has an email column — the 0033 PII split has not been applied'; end if;
  select count(*) into missing from profiles p
    left join profile_private pp on pp.profile_id = p.id
   where p.id::text like 'a000000%' and pp.email is null;
  if missing > 0 then raise exception 'T17 FAIL: % harness profile(s) have no profile_private email row', missing; end if;
  raise notice 'T17 PASS: profiles.email is gone; the login email lives in profile_private';
end $$;

-- T18 — rescheduling re-arms reminders (0035 E). reminders_sent is keyed
-- (fixture, hours_before, kind) and used to survive a date change, so a moved
-- game silently got no reminders for its new date. Ledger rows are written as
-- postgres (the table is service-role only). The trigger must fire on an
-- ACTUAL change of match_date or kickoff and on nothing else.
reset role;
do $$ declare n int; begin
  insert into reminders_sent (fixture_id, hours_before, kind) values
    ('d0000001-0000-0000-0000-000000000001', 72, 'availability'),
    ('d0000001-0000-0000-0000-000000000001', 24, 'match');
  -- an unrelated edit leaves the ledger alone
  update fixtures set venue = 'Moved Pitch' where id = 'd0000001-0000-0000-0000-000000000001';
  select count(*) into n from reminders_sent where fixture_id = 'd0000001-0000-0000-0000-000000000001';
  if n <> 2 then raise exception 'T18 FAIL: an unrelated fixture edit cleared the reminder ledger (% row(s) left)', n; end if;
  -- a no-op "change" leaves it alone too
  update fixtures set match_date = match_date where id = 'd0000001-0000-0000-0000-000000000001';
  select count(*) into n from reminders_sent where fixture_id = 'd0000001-0000-0000-0000-000000000001';
  if n <> 2 then raise exception 'T18 FAIL: a no-op date update cleared the ledger'; end if;
  -- moving the date re-arms every offset of every kind
  update fixtures set match_date = match_date + 7 where id = 'd0000001-0000-0000-0000-000000000001';
  select count(*) into n from reminders_sent where fixture_id = 'd0000001-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'T18 FAIL: rescheduling left % ledger row(s) — no reminders would fire for the new date', n; end if;
  -- and so does a kickoff change on its own
  insert into reminders_sent (fixture_id, hours_before, kind) values ('d0000001-0000-0000-0000-000000000001', 24, 'availability');
  update fixtures set kickoff = '15:00' where id = 'd0000001-0000-0000-0000-000000000001';
  select count(*) into n from reminders_sent where fixture_id = 'd0000001-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'T18 FAIL: a kickoff change left the ledger armed'; end if;
  raise notice 'T18 PASS: a date or kickoff change re-arms reminders; other edits and no-op updates do not';
end $$;

-- T19 — team_memberships is club-scoped (0035 F1). It was `auth.uid() is not
-- null`, so uC (another club) could list every squad in the system — including
-- his own trigger-seeded row on OUR reserves, which he must now not see either.
reset role; select pg_temp.act_as('a0000005-0000-0000-0000-000000000005'); set local role authenticated;
do $$ declare n int; begin
  select count(*) into n from team_memberships;
  if n > 0 then raise exception 'T19 FAIL: a different-club user can read % of our squad membership row(s)', n; end if;
end $$;
-- positive control: a club-1 member still sees the club's squads
reset role; select pg_temp.act_as('a0000002-0000-0000-0000-000000000002'); set local role authenticated;
do $$ declare n int; begin
  select count(*) into n from team_memberships
   where team_id in ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444');
  if n = 0 then raise exception 'T19 FAIL: a club member can no longer see their own club''s memberships'; end if;
end $$;
-- and the admin write is scoped too: our admin cannot register anyone into
-- ANOTHER club's team (is_admin() is global; the team's club gates it)
reset role; select pg_temp.act_as('a0000001-0000-0000-0000-000000000001'); set local role authenticated;
do $$ declare blocked boolean := false; begin
  begin insert into team_memberships (profile_id, team_id)
        values ('a0000005-0000-0000-0000-000000000005','b3333333-3333-3333-3333-333333333333');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'T19 FAIL: our admin wrote a membership into another club''s team'; end if;
  raise notice 'T19 PASS: team_memberships is club-scoped for read and admin write';
end $$;

-- T20 — the security-definer helpers cannot be executed by anon (0035 F2).
-- They were EXECUTE-able via the default PUBLIC grant; authenticated must keep
-- it (every policy calls them as the requesting role) and the delete RPC is
-- service_role only. Checked via the catalogue for every signature, then
-- proven in practice for one as the anon role.
reset role;
do $$ declare fn text; begin
  foreach fn in array array[
    'public.is_admin(uuid)', 'public.is_active_player(uuid)', 'public.is_approved_member(uuid)',
    'public.can_respond_to_fixture(uuid, uuid)', 'public.fixture_open_for_responses(uuid)',
    'public.current_club_id()', 'public.can_select_fixture(uuid, uuid)'
  ] loop
    if has_function_privilege('anon', fn, 'EXECUTE') then raise exception 'T20 FAIL: anon can execute %', fn; end if;
    if not has_function_privilege('authenticated', fn, 'EXECUTE') then raise exception 'T20 FAIL: authenticated lost execute on % (every policy would break)', fn; end if;
  end loop;
  if has_function_privilege('anon', 'public.anonymise_and_delete_profile(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.anonymise_and_delete_profile(uuid, uuid)', 'EXECUTE') then
    raise exception 'T20 FAIL: anonymise_and_delete_profile is executable by anon/authenticated'; end if;
  if not has_function_privilege('service_role', 'public.anonymise_and_delete_profile(uuid, uuid)', 'EXECUTE') then
    raise exception 'T20 FAIL: service_role cannot execute anonymise_and_delete_profile (admin-delete-player would fail)'; end if;
end $$;
set local role anon;
do $$ declare blocked boolean := false; begin
  begin perform is_admin('a0000001-0000-0000-0000-000000000001');
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'T20 FAIL: the anon role executed is_admin()'; end if;
end $$;
reset role; set local role authenticated;
do $$ begin
  perform is_admin('a0000001-0000-0000-0000-000000000001');   -- must not raise
  raise notice 'T20 PASS: helpers revoked from anon, kept for authenticated; delete RPC is service_role only';
end $$;

-- T21 — competition_squad_guard serialises registrations (0035 F3) and still
-- enforces the cap. The guard's pg_advisory_xact_lock is keyed on
-- hashtext(competition_id) and held to end of transaction, so it is visible in
-- pg_locks for this backend right after an insert — under the exact
-- classid/objid the int8 key maps to, so a lock left by anything else cannot
-- satisfy the check.
reset role;
do $$ declare k bigint := hashtext('e0000001-0000-0000-0000-000000000001')::bigint; n int; blocked boolean := false; begin
  update competitions set squad_limit_enabled = true, squad_limit = 1 where id = 'e0000001-0000-0000-0000-000000000001';
  insert into competition_squads (competition_id, profile_id, season_id)
    values ('e0000001-0000-0000-0000-000000000001','a0000002-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222');
  select count(*) into n from pg_locks
   where locktype = 'advisory' and pid = pg_backend_pid() and granted
     and objsubid = 1
     and classid = ((k >> 32) & 4294967295)::oid
     and objid   = (k & 4294967295)::oid;
  if n = 0 then raise exception 'T21 FAIL: competition_squad_guard took no advisory lock on the competition — concurrent registrations can beat the cap'; end if;
  begin insert into competition_squads (competition_id, profile_id, season_id)
        values ('e0000001-0000-0000-0000-000000000001','a0000003-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222');
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'T21 FAIL: the squad cap was not enforced'; end if;
  raise notice 'T21 PASS: squad registration locks per competition and the cap holds';
end $$;

-- T22 — media_admin_update is initplan-wrapped on BOTH halves (0035 F4). 0031
-- rewrote its USING but not its WITH CHECK. pg_get_expr renders the wrapper as
-- "( SELECT is_admin(auth.uid()) …)", so the un-wrapped form has no SELECT at all.
reset role;
do $$ declare wc text; u text; begin
  select pg_get_expr(polwithcheck, polrelid), pg_get_expr(polqual, polrelid) into wc, u
    from pg_policy where polname = 'media_admin_update' and polrelid = 'storage.objects'::regclass;
  if wc is null or position('SELECT' in wc) = 0 then raise exception 'T22 FAIL: media_admin_update WITH CHECK is not initplan-wrapped: %', coalesce(wc, '<none>'); end if;
  if u  is null or position('SELECT' in u)  = 0 then raise exception 'T22 FAIL: media_admin_update USING is not initplan-wrapped: %', coalesce(u, '<none>'); end if;
  raise notice 'T22 PASS: media_admin_update USING and WITH CHECK both evaluate is_admin() once per statement';
end $$;

-- T23 — profile_private.email is the LOGIN email and not self-service (0035 F5).
-- A member's change is reverted; the same statement's phone edit still lands
-- (the You page edits phone / dob / emergency contact); an admin can correct it.
reset role; select pg_temp.act_as('a0000002-0000-0000-0000-000000000002'); set local role authenticated;
update profile_private set email = 'hijack@evil.example', phone = '07700900099'
 where profile_id = 'a0000002-0000-0000-0000-000000000002';
reset role;
do $$ declare em text; ph text; begin
  select email, phone into em, ph from profile_private where profile_id = 'a0000002-0000-0000-0000-000000000002';
  if em <> 'reserve@test.notts' then raise exception 'T23 FAIL: a member changed their own login email in profile_private (now %)', em; end if;
  if ph <> '07700900099' then raise exception 'T23 FAIL: the email guard also blocked the member''s phone edit'; end if;
end $$;
select pg_temp.act_as('a0000001-0000-0000-0000-000000000001'); set local role authenticated;
update profile_private set email = 'reserve.fixed@test.notts' where profile_id = 'a0000002-0000-0000-0000-000000000002';
reset role;
do $$ declare em text; begin
  select email into em from profile_private where profile_id = 'a0000002-0000-0000-0000-000000000002';
  if em <> 'reserve.fixed@test.notts' then raise exception 'T23 FAIL: the admin could not correct a member''s email'; end if;
  raise notice 'T23 PASS: email is held for members, editable by the admin; other private fields stay self-service';
end $$;

-- T24 — profiles.photo_url only accepts this project's public media bucket
-- (0035 F6). Own-row update is allowed by profiles_update, so the refusal can
-- only be the check constraint.
reset role; select pg_temp.act_as('a0000002-0000-0000-0000-000000000002'); set local role authenticated;
do $$ declare blocked boolean; begin
  blocked := false;
  begin update profiles set photo_url = 'https://evil.example/tracker.png' where id = 'a0000002-0000-0000-0000-000000000002';
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'T24 FAIL: profiles.photo_url accepted an external URL'; end if;
  blocked := false;
  begin update profiles set photo_url = 'data:image/svg+xml;base64,PHN2Zy8+' where id = 'a0000002-0000-0000-0000-000000000002';
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'T24 FAIL: profiles.photo_url accepted a data: URL'; end if;
  -- the real shape (src/lib/storage.js → getPublicUrl) is fine, and so is clearing it
  update profiles set photo_url = 'https://vgeosccpwsdosbcnpcve.supabase.co/storage/v1/object/public/media/players/a0000002.jpg'
   where id = 'a0000002-0000-0000-0000-000000000002';
  update profiles set photo_url = null where id = 'a0000002-0000-0000-0000-000000000002';
  raise notice 'T24 PASS: photo_url is constrained to the public media bucket';
end $$;

-- T25 — anonymise_and_delete_profile (0035 D): service-role only, club-checked,
-- and ATOMIC. History for uB is seeded first: a goal (with uA's assist, which
-- must be left alone), a MOTM, a line-up row with NO name snapshot, and a subs
-- record. Runs LAST because it really does delete uB.
reset role;
insert into results (fixture_id, us, them, motm_profile_id)
  values ('d0000004-0000-0000-0000-000000000004', 2, 1, 'a0000003-0000-0000-0000-000000000003');
insert into goals (id, fixture_id, scorer_profile_id, assist_profile_id, minute)
  values ('f0000001-0000-0000-0000-000000000001','d0000004-0000-0000-0000-000000000004',
          'a0000003-0000-0000-0000-000000000003','a0000002-0000-0000-0000-000000000002', 12);
insert into lineups (fixture_id, profile_id, role)
  values ('d0000004-0000-0000-0000-000000000004','a0000003-0000-0000-0000-000000000003','start');
insert into payments (fixture_id, profile_id, paid)
  values ('d0000004-0000-0000-0000-000000000004','a0000003-0000-0000-0000-000000000003', true);

-- (a) not callable by a signed-in user — not even the admin (the Edge Function
--     calls it with the service role after its own admin check)
select pg_temp.act_as('a0000001-0000-0000-0000-000000000001'); set local role authenticated;
do $$ declare blocked boolean := false; begin
  begin perform anonymise_and_delete_profile('a0000003-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111');
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'T25 FAIL: an authenticated admin executed anonymise_and_delete_profile directly'; end if;
end $$;
reset role;

-- (b) a caller from the wrong club is refused, and nothing has changed
do $$ declare blocked boolean := false; begin
  begin perform anonymise_and_delete_profile('a0000003-0000-0000-0000-000000000003','b1111111-1111-1111-1111-111111111111');
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'T25 FAIL: the RPC deleted a profile for a caller from another club'; end if;
  if not exists (select 1 from profiles where id = 'a0000003-0000-0000-0000-000000000003') then
    raise exception 'T25 FAIL: profile gone despite the club refusal'; end if;
  if (select scorer_profile_id from goals where id = 'f0000001-0000-0000-0000-000000000001') is null then
    raise exception 'T25 FAIL: goal link stripped despite the club refusal'; end if;
end $$;

-- (c) ATOMICITY. Force the final profile delete to fail and prove the
--     anonymising updates that ran before it did NOT stick. This is the
--     failure the old five-statement Edge Function could not survive.
create or replace function public.t25_block_delete() returns trigger language plpgsql as $$
begin raise exception 'T25 simulated failure' using errcode = 'P0001'; end $$;
create trigger t25_block_delete before delete on profiles
  for each row when (old.id = 'a0000003-0000-0000-0000-000000000003') execute function public.t25_block_delete();
do $$ declare failed boolean := false; begin
  begin perform anonymise_and_delete_profile('a0000003-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111');
  exception when others then failed := true; end;
  if not failed then raise exception 'T25 FAIL: the simulated delete failure did not fire'; end if;
  if (select scorer_profile_id from goals where id = 'f0000001-0000-0000-0000-000000000001') is null then
    raise exception 'T25 FAIL: NOT atomic — the goal was anonymised but the player was not deleted'; end if;
  if (select motm_profile_id from results where fixture_id = 'd0000004-0000-0000-0000-000000000004') is null then
    raise exception 'T25 FAIL: NOT atomic — the MOTM was anonymised but the player was not deleted'; end if;
  if not exists (select 1 from payments where profile_id = 'a0000003-0000-0000-0000-000000000003') then
    raise exception 'T25 FAIL: NOT atomic — payments were dropped but the player was not deleted'; end if;
end $$;
drop trigger t25_block_delete on profiles;
drop function public.t25_block_delete();

-- (d) the real thing: names snapshotted, links nulled, player gone, history kept
do $$ declare r jsonb; g record; begin
  r := anonymise_and_delete_profile('a0000003-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111');
  if (r->>'deleted') is distinct from 'true' then raise exception 'T25 FAIL: RPC did not report deleted (%)', r; end if;
  if exists (select 1 from profiles where id = 'a0000003-0000-0000-0000-000000000003') then
    raise exception 'T25 FAIL: profile still exists after the RPC'; end if;
  select scorer_profile_id, scorer_name, assist_profile_id, assist_name into g
    from goals where id = 'f0000001-0000-0000-0000-000000000001';
  if g.scorer_profile_id is not null or g.scorer_name is distinct from 'Aaron Webb' then
    raise exception 'T25 FAIL: goal not anonymised with a name snapshot (link %, name %)', g.scorer_profile_id, g.scorer_name; end if;
  if g.assist_profile_id is distinct from 'a0000002-0000-0000-0000-000000000002' or g.assist_name is not null then
    raise exception 'T25 FAIL: another player''s assist was touched'; end if;
  if (select motm_profile_id from results where fixture_id = 'd0000004-0000-0000-0000-000000000004') is not null
     or (select motm_name from results where fixture_id = 'd0000004-0000-0000-0000-000000000004') is distinct from 'Aaron Webb' then
    raise exception 'T25 FAIL: MOTM not anonymised with a name snapshot'; end if;
  if (select player_name from lineups where fixture_id = 'd0000004-0000-0000-0000-000000000004' and profile_id is null) is distinct from 'Aaron Webb' then
    raise exception 'T25 FAIL: the line-up row lost the player''s name'; end if;
  if exists (select 1 from payments where profile_id = 'a0000003-0000-0000-0000-000000000003') then
    raise exception 'T25 FAIL: payments survived the delete'; end if;
  if (r->>'goals_scorer')::int <> 1 or (r->>'motm')::int <> 1 or (r->>'lineups')::int <> 1 or (r->>'payments')::int <> 1 then
    raise exception 'T25 FAIL: RPC counts are off: %', r; end if;
  raise notice 'T25 PASS: anonymise_and_delete_profile is service-role only, club-checked and atomic; history keeps the name';
end $$;

-- T26 — 0036: anonymous storage listing is closed; client_errors can't spoof
-- a club or grow without limit.
reset role; set local role anon;
do $$ declare n int; begin
  select count(*) into n from storage.objects where bucket_id = 'media';
  if n > 0 then raise exception 'T26 FAIL: anon can LIST % media object(s)', n; end if;
end $$;
reset role; select pg_temp.act_as('a0000002-0000-0000-0000-000000000002'); set local role authenticated;
do $$ declare blocked boolean; begin
  -- (a) attribution can't be pinned on another club
  blocked := false;
  begin insert into client_errors (profile_id, club_id, kind, message)
        values ('a0000002-0000-0000-0000-000000000002', 'b1111111-1111-1111-1111-111111111111', 'spoof', 'not my club');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'T26 FAIL: a member logged an error against ANOTHER club'; end if;
  -- (b) the size caps hold
  blocked := false;
  begin insert into client_errors (profile_id, kind, message)
        values ('a0000002-0000-0000-0000-000000000002', 'flood', repeat('x', 2000));
  exception when others then blocked := true; end;
  if not blocked then raise exception 'T26 FAIL: an oversized error row was accepted'; end if;
  -- (c) an honest row still lands
  insert into client_errors (profile_id, club_id, kind, message)
  values ('a0000002-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'fetch', 'genuine');
  raise notice 'T26 PASS: anon cannot list media; client_errors is own-club and size-capped';
end $$;

-- ============================================================================
-- 0037 (security audit / pen-test remediation) — T27…T31
-- ============================================================================

-- T27 — the TRIGGER functions are out of the exposed API surface (0037 B).
-- 0035 F2 did this for the policy helpers but left the trigger functions on
-- their default PUBLIC grant, so the Supabase linter listed them at
-- /rest/v1/rpc/<name>. A trigger-returning function refuses a direct call, but
-- two of these are SECURITY DEFINER and none of them belong in the API.
-- Revoking EXECUTE does NOT stop a trigger firing: a trigger runs with the
-- privileges of the statement that fired it, which T5 / T8 / T23 re-prove.
reset role;
do $$ declare fn text; begin
  foreach fn in array array[
    'public.handle_new_user()', 'public.protect_profile_columns()',
    'public.protect_private_email()', 'public.rearm_fixture_reminders()',
    'public.competition_squad_guard()', 'public.touch_updated_at()'
  ] loop
    if has_function_privilege('anon', fn, 'EXECUTE') then
      raise exception 'T27 FAIL: anon can execute the trigger function %', fn; end if;
    if has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'T27 FAIL: authenticated can execute the trigger function %', fn; end if;
  end loop;
  raise notice 'T27 PASS: trigger functions are not callable as RPC by anon or authenticated';
end $$;

-- T28 — reminders_sent is shut TWICE: RLS on with no policies (0008) AND no
-- table grant to the API roles (0037 C). It held Supabase's default grants, so
-- it was one accidental `disable row level security` away from world-writable.
reset role;
do $$ declare n int; begin
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'reminders_sent' and grantee in ('anon','authenticated');
  if n > 0 then raise exception 'T28 FAIL: % grant(s) on reminders_sent still held by anon/authenticated', n; end if;
  if not exists (select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
                  where ns.nspname = 'public' and c.relname = 'reminders_sent' and c.relrowsecurity)
    then raise exception 'T28 FAIL: RLS is off on reminders_sent'; end if;
end $$;
select pg_temp.act_as('a0000001-0000-0000-0000-000000000001'); set local role authenticated;
do $$ declare blocked boolean := false; begin
  begin perform 1 from reminders_sent;
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'T28 FAIL: an admin read the reminder ledger'; end if;
  raise notice 'T28 PASS: reminders_sent is closed by privilege AND by RLS';
end $$;

-- T29 — every rendered image URL is pinned to this project's media bucket
-- (0037 D; 0035 F6 did profiles.photo_url alone). An arbitrary string in any of
-- these is an <img src> for the whole club: an external tracker, a beacon that
-- logs every member's IP, a data: URL. CHECK constraints are not role-scoped,
-- so this runs as postgres — if the constraint holds here it holds for admins.
reset role;
do $$
declare
  hostile text := 'https://evil.example/beacon.png';
  good    text := 'https://vgeosccpwsdosbcnpcve.supabase.co/storage/v1/object/public/media/photos/ok.jpg';
  blocked boolean;
begin
  blocked := false;
  begin update sponsors set logo_url = hostile where club_id = '11111111-1111-1111-1111-111111111111';
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'T29 FAIL: sponsors.logo_url accepted an off-bucket URL'; end if;

  blocked := false;
  begin update opponents set badge_url = hostile where club_id = '11111111-1111-1111-1111-111111111111';
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'T29 FAIL: opponents.badge_url accepted an off-bucket URL'; end if;

  blocked := false;
  begin update clubs set crest_url = hostile where id = '11111111-1111-1111-1111-111111111111';
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'T29 FAIL: clubs.crest_url accepted an off-bucket URL'; end if;

  blocked := false;
  begin insert into media_assets (club_id, type, url)
        values ('11111111-1111-1111-1111-111111111111', 'photo', hostile);
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'T29 FAIL: media_assets.url accepted an off-bucket URL'; end if;

  -- An UPDATE that matches no row is a vacuous pass, so make sure a result exists.
  if not exists (select 1 from results where fixture_id = 'd0000001-0000-0000-0000-000000000001') then
    insert into results (fixture_id, us, them) values ('d0000001-0000-0000-0000-000000000001', 1, 0);
  end if;
  blocked := false;
  begin update results set motm_photo_url = hostile where fixture_id = 'd0000001-0000-0000-0000-000000000001';
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'T29 FAIL: results.motm_photo_url accepted an off-bucket URL'; end if;

  -- …and a genuine bucket URL still saves, or the constraint is just a wall.
  update clubs set crest_url = good where id = '11111111-1111-1111-1111-111111111111';
  raise notice 'T29 PASS: all five image URL columns are pinned to the media bucket';
end $$;

-- T30 — the admin branch of profiles_update is club-scoped (0037 E), and
-- nobody can walk their OWN account into another club (0037 F). is_admin() is
-- global, so without the club term our manager could have rewritten Other FC's
-- squad — and, since an admin skips the not-is_admin column freeze, carried
-- their own admin role across by editing club_id.
reset role; select pg_temp.act_as('a0000001-0000-0000-0000-000000000001'); set local role authenticated;
do $$ declare n int; blocked boolean := false; begin
  -- (a) another club's profile is untouchable
  update profiles set first_name = 'Hijacked' where id = 'a0000005-0000-0000-0000-000000000005';
  get diagnostics n = row_count;
  if n > 0 then raise exception 'T30 FAIL: our admin updated another club profile'; end if;

  -- (b) an admin cannot move their own account (and its role) to another club
  begin
    update profiles set club_id = 'b1111111-1111-1111-1111-111111111111'
     where id = 'a0000001-0000-0000-0000-000000000001';
  exception when others then blocked := true; end;
  if not blocked then raise exception 'T30 FAIL: the admin moved their own account to another club'; end if;

  -- (c) the ordinary admin edit inside their own club still works
  update profiles set first_name = 'Jordan' where id = 'a0000002-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'T30 FAIL: a same-club admin edit was blocked (% rows). The club term is too tight', n; end if;
  raise notice 'T30 PASS: profiles_update is club-scoped and self-club is locked';
end $$;

-- T31 — availability_delete is club-scoped too (0037 E). It stays deliberately
-- open on own-row and on kickoff (0034 §3: withdrawing an answer must always
-- work); this only stops a DELETE crossing a club boundary.
reset role;
insert into availability (fixture_id, profile_id, status)
values ('d0000003-0000-0000-0000-000000000003','a0000005-0000-0000-0000-000000000005','in')
on conflict (fixture_id, profile_id) do nothing;
select pg_temp.act_as('a0000001-0000-0000-0000-000000000001'); set local role authenticated;
do $$ declare n int; begin
  delete from availability
   where fixture_id = 'd0000003-0000-0000-0000-000000000003'
     and profile_id = 'a0000005-0000-0000-0000-000000000005';
  get diagnostics n = row_count;
  if n > 0 then raise exception 'T31 FAIL: our admin deleted another club availability row'; end if;
end $$;
reset role;
do $$ begin
  -- The delete above returning 0 rows is only meaningful if the row was there.
  if not exists (select 1 from availability
                  where fixture_id = 'd0000003-0000-0000-0000-000000000003'
                    and profile_id = 'a0000005-0000-0000-0000-000000000005')
    then raise exception 'T31 FAIL: the other club row is gone — the check above was vacuous'; end if;
  raise notice 'T31 PASS: availability_delete cannot cross a club boundary';
end $$;


reset role;
do $$ begin raise notice '================  ALL RLS TESTS PASSED  ================'; end $$;

rollback;
