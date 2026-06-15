-- ============================================================================
-- Nottinghamshire MvF — seed data
-- One club, one current season, two teams. Idempotent (safe to re-run).
-- Run AFTER 0001_init_schema_and_rls.sql, BEFORE tests/rls_test.sql.
-- Fixed UUIDs so the frontend and tests can rely on them.
-- ============================================================================

-- The club ----------------------------------------------------------------
insert into clubs (id, name)
values ('11111111-1111-1111-1111-111111111111', 'Nottinghamshire MvF')
on conflict (id) do nothing;

-- Current season ----------------------------------------------------------
insert into seasons (id, club_id, label, is_current)
values ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', '2025/26', true)
on conflict (id) do nothing;

-- Two teams: First Team (key 'xl', red) listed first; Community (reserves, green)
insert into teams (id, club_id, key, label, is_first_team, colour, league_name)
values
  ('33333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111',
   'xl', 'First Team', true, '#E11D2A', 'MvF XL National League'),
  ('44444444-4444-4444-4444-444444444444',
   '11111111-1111-1111-1111-111111111111',
   'community', 'Community', false, '#2FA84F', 'MvF Community League')
on conflict (club_id, key) do nothing;
