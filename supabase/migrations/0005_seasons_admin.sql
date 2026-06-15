-- ============================================================================
-- Migration 0005: seasons admin fields (BUILD-LIST A3)
-- Seasons gain start/end dates so the admin can define when a season runs.
-- Rollover is a scoping concern, not a data copy: players + opponents are
-- season-independent and carry forward; fixtures/results/goals/table/stats are
-- all keyed by season_id, so a new current season simply shows fresh while old
-- seasons stay viewable via the picker. RLS already admin-only for writes.
-- ============================================================================

alter table seasons
  add column if not exists start_date date,
  add column if not exists end_date date;
