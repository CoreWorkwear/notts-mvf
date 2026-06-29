-- ============================================================================
-- Migration 0029: competitions get an `active` flag + `sort_order`.
-- Lets a manager RETIRE an old league/cup (e.g. a renamed first-team league) so it
-- drops out of the current season's UI WITHOUT deleting it — preserving its past
-- fixtures/results. `sort_order` controls listing order (First Team league first,
-- Community next, …). Admin-writable via the existing competitions RLS; no policy
-- change needed.
-- ============================================================================
alter table competitions
  add column if not exists active boolean not null default true,
  add column if not exists sort_order int not null default 0;

-- Helps the season-scoped, ordered reads the app does.
create index if not exists competitions_season_active_idx
  on competitions (season_id, active, sort_order);
