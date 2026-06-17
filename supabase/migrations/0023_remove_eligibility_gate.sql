-- ============================================================================
-- Migration 0023: §1a — remove the XL eligibility (+ team-membership) VISIBILITY
-- gate. Fixtures are now visible to any active member of the club; First Team
-- games are no longer hidden from anyone. can_select_fixture is the single source
-- used by the fixtures SELECT policy AND the availability write policies, so this
-- one redefinition removes the gate everywhere.
--
-- All OTHER gates are deliberately untouched and re-proven by the harness
-- (supabase/tests/rls_test.sql): availability writes still require an approved,
-- active player (is_active_player) and own-row; admin-only writes, the
-- self-promotion block and cross-club isolation all remain.
--
-- NOTE: the now-vestigial profiles.xl_eligible column is dropped in a LATER
-- migration, once the frontend + edge functions that still select it have been
-- redeployed (avoids a window where a stale build queries a missing column).
-- ============================================================================
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
    join profiles p on p.id = _uid
    where f.id = _fixture_id
      and p.active
      and p.club_id = f.club_id      -- club membership only; no team/eligibility gate
  );
$$;
