-- ============================================================================
-- Migration 0034: availability responses are TEAM-SCOPED.
--
-- Reported bug: a Community-only player (Alan Lenihan among others) could mark
-- himself in / maybe / out for a First Team fixture. 0023 removed the old
-- eligibility gate from `can_select_fixture`, which was RIGHT for VISIBILITY —
-- everyone in the club should see every fixture — but that one function was
-- also doing duty as the availability WRITE gate, so removing it opened the
-- write side too. 25 such rows existed in production when this was written.
--
-- The fix splits the two jobs apart, which is what 0023 should have done:
--   • can_select_fixture       — UNCHANGED. Club-scoped visibility. Read by
--                                fixtures_select AND lineups_select, so
--                                tightening it would re-hide First Team games
--                                AND their line-ups. Do not touch it.
--   • can_respond_to_fixture   — NEW. Club + membership of the fixture's team.
--   • fixture_open_for_responses — NEW. Before kickoff (Europe/London).
--
-- Deliberately NO admin bypass in can_respond_to_fixture (unlike
-- can_select_fixture, which carries `is_admin(_uid) or`): the rule is uniform,
-- so a First-Team-only manager cannot answer a Community game either. A manager
-- calling a player up from the reserves adds them to that squad in Players —
-- that is the sanctioned route, and it is what the club chose over an
-- admin-answers-on-your-behalf carve-out.
--
-- availability_delete stays OPEN (own-row or admin) on purpose — see §3.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Helpers. Both single-purpose: the 0023 mistake was one function serving
--    two masters. Both `security definer` + pinned search_path (the class of
--    fix 0032 established), so the policies can read tables the caller cannot.
-- ---------------------------------------------------------------------------

-- Is this user in the squad that plays this fixture? Club-scoped and active.
-- Approval / is_player deliberately stay is_active_player()'s job so the two
-- gates compose in the policy rather than duplicating each other.
create or replace function public.can_respond_to_fixture(_fixture_id uuid, _uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from fixtures f
    join profiles p          on p.id = _uid
    join team_memberships tm on tm.profile_id = _uid and tm.team_id = f.team_id
    where f.id = _fixture_id
      and p.active
      and p.club_id = f.club_id
  );
$$;

-- Has this fixture not kicked off yet? Availability is a question about a game
-- still to come; once the players are out there the answer is a matter of
-- record. Reckoned in Europe/London to agree with hasKickedOff() in
-- src/lib/format.js — `match_date + kickoff` is a naive wall-clock timestamp,
-- so `at time zone 'Europe/London'` reads it as club time (GMT/BST aware) and
-- yields the real instant to compare against now(). A plain `> current_date`
-- would disagree with the app around midnight and drift by an hour all summer.
create or replace function public.fixture_open_for_responses(_fixture_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from fixtures f
    where f.id = _fixture_id
      and ((f.match_date + f.kickoff) at time zone 'Europe/London') > now()
  );
$$;

-- ---------------------------------------------------------------------------
-- 2) The write policies. can_respond_to_fixture REPLACES can_select_fixture
--    here (it is strictly stronger for non-admins — it re-asserts p.active and
--    p.club_id = f.club_id, then adds the squad join). Both new terms go in
--    WITH CHECK, never in UPDATE's USING: a row excluded by USING is a silent
--    zero-row success, so PostgREST would return 200 and the player would think
--    their answer saved. A failing WITH CHECK raises 42501, which the UI can
--    actually report. 0031's initplan convention holds — auth.uid() is wrapped
--    in (select …) as a per-request constant; the helpers take the per-ROW
--    fixture_id column so they stay per-row calls.
-- ---------------------------------------------------------------------------

alter policy availability_insert on public.availability
  with check ((profile_id = (select auth.uid()))
              and can_respond_to_fixture(fixture_id, (select auth.uid()))
              and fixture_open_for_responses(fixture_id)
              and (select is_active_player(auth.uid())));

alter policy availability_update on public.availability
  using ((profile_id = (select auth.uid())) and (select is_active_player(auth.uid())))
  with check ((profile_id = (select auth.uid()))
              and can_respond_to_fixture(fixture_id, (select auth.uid()))
              and fixture_open_for_responses(fixture_id)
              and (select is_active_player(auth.uid())));

-- ---------------------------------------------------------------------------
-- 3) availability_delete is LEFT ALONE (own-row or admin, no team or kickoff
--    term) — this is considered, not an oversight. Withdrawing an answer must
--    always work: a player moved out of a squad after answering keeps the row
--    (availability FKs fixtures and profiles, never team_memberships, so
--    nothing cascades) and can still see it and clear it, but can no longer
--    change it. Admins need the same door to tidy up. A DELETE cannot create
--    an unauthorised row, so it is not a way round the gate.
-- ---------------------------------------------------------------------------

-- No new index: `unique (profile_id, team_id)` on team_memberships (0001) is
-- already the exact composite btree can_respond_to_fixture probes, and 0001
-- already granted availability DML to `authenticated`.

-- ---------------------------------------------------------------------------
-- 4) Close the back door into team_memberships.
--    handle_new_user is SECURITY DEFINER, so it bypasses memberships_admin_write
--    and — until now — granted whatever squads the signup form asked for, from
--    client-controlled raw_user_meta_data. Harmless while membership gated
--    nothing; not harmless now that it decides who may answer a First Team
--    fixture. A self-signup ticking "XL 11s" would have been granted it, and
--    the manager's sign-off button is about the ACCOUNT, not the squad.
--
--    Self-signup now ALWAYS lands in the reserves; squads are the manager's to
--    assign in Players. The requested squads are kept on the profile as
--    `requested_teams` so the manager can see what the player asked for
--    instead of the information being thrown away.
--
--    The admin paths stay authoritative: admin-create-player RECONCILES the
--    memberships itself with the service role after createUser — it adds the
--    squads the manager ticked and removes the ones they didn't, because the
--    reserves seed below fires for an admin-created account too (the trigger is
--    on auth.users and cannot tell the two apart). Redeploy that function with
--    this migration. PlayerForm writes team_memberships directly under
--    memberships_admin_write on the edit path.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists requested_teams text[] not null default '{}';

comment on column public.profiles.requested_teams is
  'Squads the player ticked at signup. A REQUEST, not a grant — real membership lives in team_memberships and is the manager''s to give.';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_club_id uuid; v_team_id uuid;
  v_is_player boolean := coalesce((new.raw_user_meta_data->>'is_player')::boolean, true);
  v_requested text[] := coalesce(
    (select array_agg(value) from jsonb_array_elements_text(new.raw_user_meta_data->'teams')), '{}');
begin
  select id into v_club_id from clubs order by created_at limit 1;
  insert into profiles (id, club_id, first_name, last_name, positions, preferred,
                        role, active, approved, is_player, requested_teams)
  values (new.id, v_club_id,
    new.raw_user_meta_data->>'first_name', new.raw_user_meta_data->>'last_name',
    coalesce((select array_agg(value) from jsonb_array_elements_text(new.raw_user_meta_data->'positions')), '{}'),
    nullif(new.raw_user_meta_data->>'preferred',''),
    'player', true, false, v_is_player,
    case when v_is_player then v_requested else '{}'::text[] end);  -- forced: player / active / PENDING
  insert into profile_private (profile_id, email, phone, dob)
  values (new.id, new.email, new.raw_user_meta_data->>'phone',
    nullif(new.raw_user_meta_data->>'dob','')::date);
  -- Squad membership is NOT self-service. Everyone starts in the reserves; the
  -- manager moves them up. (Was: a loop granting every key in the metadata.)
  if v_is_player then
    select id into v_team_id from teams where club_id = v_club_id and key = 'community';
    if v_team_id is not null then
      insert into team_memberships (profile_id, team_id) values (new.id, v_team_id) on conflict do nothing;
    end if;
  end if;
  return new;
end; $function$;

-- ---------------------------------------------------------------------------
-- 5) Clean up the rows the old gate let through — UPCOMING FIXTURES ONLY.
--    Those are the ones distorting live numbers right now (they inflate `in`
--    and understate `not replied` on the next First Team games). Rows on games
--    already played are LEFT ALONE on purpose: on a handful of older fixtures
--    with no saved line-up, `availability.status = 'in'` is the only surviving
--    record of who actually turned out (MatchCentre falls back to it), and
--    rewriting that would be rewriting history. 4 rows at time of writing.
-- ---------------------------------------------------------------------------

delete from public.availability a
using public.fixtures f
where f.id = a.fixture_id
  and ((f.match_date + f.kickoff) at time zone 'Europe/London') > now()
  and not exists (
    select 1 from public.team_memberships tm
    where tm.profile_id = a.profile_id and tm.team_id = f.team_id
  );
