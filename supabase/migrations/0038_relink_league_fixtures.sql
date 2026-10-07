-- ============================================================================
-- Migration 0038 (DATA ONLY): re-link four First Team League fixtures to
-- their league.
-- ----------------------------------------------------------------------------
-- No schema change. Idempotent: it touches only the four ids below, and only
-- while their competition_id is still null. On a database that does not hold
-- these rows (staging, a fresh build) it updates nothing.
--
-- Why: until October 2026 the fixture edit form wrote competition_id and
-- league_name back as NULL on every save. useFixtures never selected
-- competition_id, so the form opened on "none" and saved that. Any edit — a
-- kickoff change, a venue fix — unlinked the game from its league. The app fix
-- (FIXTURE_COLUMNS in src/hooks/useFixtures.js) ships in the same change as
-- this file. RUN THIS AFTER THAT BUILD IS LIVE, or the next edit from a cached
-- old build unlinks them again.
--
-- Before-image (live, 7 Oct 2026). Season 2026/27 had 11 League fixtures. Seven
-- were linked. These four, all First Team, had competition_id NULL and
-- league_name NULL:
--   38b5a211-e801-4622-b114-cc98a7b4fdbf   away, 2026-09-06
--   9b5eddd6-532d-4a51-a0b6-689291c86065   home, 2026-09-27
--   b40d13ac-f2e5-46ac-90ed-56019e15aa1f   away, 2027-02-28
--   7cd15103-734f-402d-bb12-d62aa3fbf781   home, 2027-04-04
-- The First Team has one active league that season, "MvF Midlands League"
-- (4ff60a66-280f-49c5-b87f-c097c61c4652), which the other six First Team League
-- fixtures already point at.
--
-- Undo:
--   update public.fixtures set competition_id = null, league_name = null
--    where id in (<the four ids above>);
--
-- The join to competitions is the guard: the competition must exist, and be in
-- the same club and season as the fixture, or nothing is written.
-- ============================================================================

update public.fixtures f
   set competition_id = c.id,
       league_name    = c.name
  from public.competitions c
 where c.id = '4ff60a66-280f-49c5-b87f-c097c61c4652'
   and f.id in (
     '38b5a211-e801-4622-b114-cc98a7b4fdbf',
     '9b5eddd6-532d-4a51-a0b6-689291c86065',
     'b40d13ac-f2e5-46ac-90ed-56019e15aa1f',
     '7cd15103-734f-402d-bb12-d62aa3fbf781'
   )
   and f.competition_id is null
   and f.fixture_type = 'League'
   and f.season_id = c.season_id
   and f.club_id   = c.club_id;
