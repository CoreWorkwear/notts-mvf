-- ============================================================================
-- Migration 0004: opponents admin fields (BUILD-LIST A2)
-- Opponents persist across seasons (a badge attaches to the opponent, reused
-- every game vs them). Add a home ground and a league-vs-one-off flag so the
-- panel can keep casual friendly opponents lightweight while league teams get
-- full detail. RLS already in place (select authed in club, write admin).
-- ============================================================================

alter table opponents
  add column if not exists home_venue text,
  add column if not exists is_league_team boolean not null default false;
