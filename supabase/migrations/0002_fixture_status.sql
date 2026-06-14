-- ============================================================================
-- Migration 0002: fixture status (for Postponed / P-P handling)
-- ----------------------------------------------------------------------------
-- A fixture is normally 'scheduled'. Admins can mark it 'postponed' (P-P).
-- "Played" is NOT a status — it's derived from a results row existing, and the
-- move out of Fixtures into Results is time-based (kickoff + 4h, London time),
-- computed in the app. Run this in the SQL editor after 0001 + seed.
-- ============================================================================

alter table fixtures
  add column if not exists status text not null default 'scheduled'
  check (status in ('scheduled', 'postponed'));
