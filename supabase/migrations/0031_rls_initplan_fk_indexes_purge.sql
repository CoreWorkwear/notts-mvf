-- ============================================================================
-- Migration 0031: healthcheck item 7 — RLS initplan wrapping, FK indexes,
-- history purge jobs. No semantic change to any policy: every rewrite wraps a
-- per-request-constant call in (select ...) so Postgres evaluates it ONCE per
-- statement (an InitPlan) instead of once per row — the standard Supabase
-- performance-advisor fix. Invisible at today's row counts; matters when the
-- multi-tenant Beta multiplies them.
--
-- Wrapping rules (and why they are safe):
--   is_admin(auth.uid())          -> (select is_admin(auth.uid()))
--   is_active_player(auth.uid())  -> (select is_active_player(auth.uid()))
--   is_approved_member(auth.uid())-> (select is_approved_member(auth.uid()))
--   current_club_id()             -> (select current_club_id())
--   bare auth.uid()               -> (select auth.uid())
-- All are STABLE and take no per-row input, so once-per-statement == per-row.
-- can_select_fixture(<row col>, ...) takes a per-ROW argument and stays as a
-- per-row call; only its auth.uid() argument is wrapped.
--
-- Verify afterwards with supabase/tests/rls_test.sql (rolls back; success
-- prints ALL RLS TESTS PASSED — every check raises on failure).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Policy rewrites — public schema
-- ---------------------------------------------------------------------------

-- clubs
alter policy clubs_select on public.clubs
  using (id = (select current_club_id()));
alter policy clubs_admin_write on public.clubs
  using ((id = (select current_club_id())) and (select is_admin(auth.uid())))
  with check ((id = (select current_club_id())) and (select is_admin(auth.uid())));

-- seasons
alter policy seasons_select on public.seasons
  using (club_id = (select current_club_id()));
alter policy seasons_admin_write on public.seasons
  using ((club_id = (select current_club_id())) and (select is_admin(auth.uid())))
  with check ((club_id = (select current_club_id())) and (select is_admin(auth.uid())));

-- teams
alter policy teams_select on public.teams
  using (club_id = (select current_club_id()));
alter policy teams_admin_write on public.teams
  using ((club_id = (select current_club_id())) and (select is_admin(auth.uid())))
  with check ((club_id = (select current_club_id())) and (select is_admin(auth.uid())));

-- profiles
alter policy profiles_select on public.profiles
  using (club_id = (select current_club_id()));
alter policy profiles_update on public.profiles
  using ((id = (select auth.uid())) or (select is_admin(auth.uid())))
  with check ((id = (select auth.uid())) or (select is_admin(auth.uid())));

-- team_memberships
alter policy memberships_select on public.team_memberships
  using ((select auth.uid()) is not null);
alter policy memberships_admin_write on public.team_memberships
  using ((select is_admin(auth.uid())))
  with check ((select is_admin(auth.uid())));

-- opponents
alter policy opponents_select on public.opponents
  using (club_id = (select current_club_id()));
alter policy opponents_admin_write on public.opponents
  using ((club_id = (select current_club_id())) and (select is_admin(auth.uid())))
  with check ((club_id = (select current_club_id())) and (select is_admin(auth.uid())));

-- media_assets
alter policy media_select on public.media_assets
  using (club_id = (select current_club_id()));
alter policy media_admin_write on public.media_assets
  using ((club_id = (select current_club_id())) and (select is_admin(auth.uid())))
  with check ((club_id = (select current_club_id())) and (select is_admin(auth.uid())));

-- fixtures
alter policy fixtures_select on public.fixtures
  using ((club_id = (select current_club_id())) and can_select_fixture(id, (select auth.uid())));
alter policy fixtures_admin_write on public.fixtures
  using ((club_id = (select current_club_id())) and (select is_admin(auth.uid())))
  with check ((club_id = (select current_club_id())) and (select is_admin(auth.uid())));

-- availability
alter policy availability_select on public.availability
  using (exists (select 1 from public.fixtures f
                 where f.id = availability.fixture_id
                   and f.club_id = (select current_club_id())));
alter policy availability_insert on public.availability
  with check ((profile_id = (select auth.uid()))
              and can_select_fixture(fixture_id, (select auth.uid()))
              and (select is_active_player(auth.uid())));
alter policy availability_update on public.availability
  using ((profile_id = (select auth.uid())) and (select is_active_player(auth.uid())))
  with check ((profile_id = (select auth.uid()))
              and can_select_fixture(fixture_id, (select auth.uid()))
              and (select is_active_player(auth.uid())));
alter policy availability_delete on public.availability
  using ((profile_id = (select auth.uid())) or (select is_admin(auth.uid())));

-- results
alter policy results_select on public.results
  using (exists (select 1 from public.fixtures f
                 where f.id = results.fixture_id
                   and f.club_id = (select current_club_id())));
alter policy results_admin_write on public.results
  using ((select is_admin(auth.uid()))
         and exists (select 1 from public.fixtures f
                     where f.id = results.fixture_id
                       and f.club_id = (select current_club_id())))
  with check ((select is_admin(auth.uid()))
              and exists (select 1 from public.fixtures f
                          where f.id = results.fixture_id
                            and f.club_id = (select current_club_id())));

-- goals
alter policy goals_select on public.goals
  using (exists (select 1 from public.fixtures f
                 where f.id = goals.fixture_id
                   and f.club_id = (select current_club_id())));
alter policy goals_admin_write on public.goals
  using ((select is_admin(auth.uid()))
         and exists (select 1 from public.fixtures f
                     where f.id = goals.fixture_id
                       and f.club_id = (select current_club_id())))
  with check ((select is_admin(auth.uid()))
              and exists (select 1 from public.fixtures f
                          where f.id = goals.fixture_id
                            and f.club_id = (select current_club_id())));

-- league_tables
alter policy league_tables_select on public.league_tables
  using (club_id = (select current_club_id()));
alter policy league_tables_admin_write on public.league_tables
  using ((club_id = (select current_club_id())) and (select is_admin(auth.uid())))
  with check ((club_id = (select current_club_id())) and (select is_admin(auth.uid())));

-- payments
alter policy payments_select on public.payments
  using (exists (select 1 from public.fixtures f
                 where f.id = payments.fixture_id
                   and f.club_id = (select current_club_id())));
alter policy payments_admin_write on public.payments
  using ((select is_admin(auth.uid()))
         and exists (select 1 from public.fixtures f
                     where f.id = payments.fixture_id
                       and f.club_id = (select current_club_id())))
  with check ((select is_admin(auth.uid()))
              and exists (select 1 from public.fixtures f
                          where f.id = payments.fixture_id
                            and f.club_id = (select current_club_id())));

-- push_tokens
alter policy push_tokens_own on public.push_tokens
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

-- announcements
alter policy announcements_select on public.announcements
  using (club_id = (select current_club_id()));
alter policy announcements_admin_write on public.announcements
  using ((club_id = (select current_club_id())) and (select is_admin(auth.uid())))
  with check ((club_id = (select current_club_id())) and (select is_admin(auth.uid())));

-- reminder_settings
alter policy reminder_settings_select on public.reminder_settings
  using (club_id = (select current_club_id()));
alter policy reminder_settings_admin_write on public.reminder_settings
  using ((club_id = (select current_club_id())) and (select is_admin(auth.uid())))
  with check ((club_id = (select current_club_id())) and (select is_admin(auth.uid())));

-- lineups
alter policy lineups_select on public.lineups
  using (can_select_fixture(fixture_id, (select auth.uid())));
alter policy lineups_admin_write on public.lineups
  using ((select is_admin(auth.uid()))
         and exists (select 1 from public.fixtures fx
                     where fx.id = lineups.fixture_id
                       and fx.club_id = (select current_club_id())))
  with check ((select is_admin(auth.uid()))
              and exists (select 1 from public.fixtures fx
                          where fx.id = lineups.fixture_id
                            and fx.club_id = (select current_club_id())));

-- sponsors
alter policy sponsors_select on public.sponsors
  using (club_id = (select current_club_id()));
alter policy sponsors_admin_write on public.sponsors
  using ((club_id = (select current_club_id())) and (select is_admin(auth.uid())))
  with check ((club_id = (select current_club_id())) and (select is_admin(auth.uid())));

-- client_errors
alter policy client_errors_insert on public.client_errors
  with check ((profile_id is null) or (profile_id = (select auth.uid())));
alter policy client_errors_admin_read on public.client_errors
  using ((select is_admin(auth.uid())));
alter policy client_errors_admin_delete on public.client_errors
  using ((select is_admin(auth.uid())));

-- competitions
alter policy competitions_select on public.competitions
  using (club_id = (select current_club_id()));
alter policy competitions_admin_write on public.competitions
  using ((club_id = (select current_club_id())) and (select is_admin(auth.uid())))
  with check ((club_id = (select current_club_id())) and (select is_admin(auth.uid())));

-- competition_squads
alter policy competition_squads_select on public.competition_squads
  using (exists (select 1 from public.competitions c
                 where c.id = competition_squads.competition_id
                   and c.club_id = (select current_club_id())));
alter policy competition_squads_admin_write on public.competition_squads
  using ((select is_admin(auth.uid()))
         and exists (select 1 from public.competitions c
                     where c.id = competition_squads.competition_id
                       and c.club_id = (select current_club_id())))
  with check ((select is_admin(auth.uid()))
              and exists (select 1 from public.competitions c
                          where c.id = competition_squads.competition_id
                            and c.club_id = (select current_club_id())));

-- ---------------------------------------------------------------------------
-- 2) Policy rewrites — storage.objects (media bucket)
-- ---------------------------------------------------------------------------

alter policy media_admin_insert on storage.objects
  with check ((bucket_id = 'media') and (select is_admin(auth.uid())));
alter policy media_admin_update on storage.objects
  using ((bucket_id = 'media') and (select is_admin(auth.uid())));
alter policy media_admin_delete on storage.objects
  using ((bucket_id = 'media') and (select is_admin(auth.uid())));
alter policy media_players_folder_insert on storage.objects
  with check ((bucket_id = 'media')
              and ((storage.foldername(name))[1] = 'players')
              and (select is_approved_member(auth.uid())));

-- ---------------------------------------------------------------------------
-- 3) FK covering indexes
-- The hot query paths were already indexed in 0001 (availability/lineups/
-- goals/payments by fixture; fixtures by club+season composite). These cover
-- the rest — chiefly the profile-side FKs that admin-delete-player scans when
-- anonymising history, plus club_id scoping for the multi-tenant Beta.
-- ---------------------------------------------------------------------------

create index if not exists profiles_club_id_idx           on public.profiles (club_id);
create index if not exists seasons_club_id_idx            on public.seasons (club_id);
create index if not exists opponents_club_id_idx          on public.opponents (club_id);
create index if not exists media_assets_club_id_idx       on public.media_assets (club_id);
create index if not exists media_assets_uploaded_by_idx   on public.media_assets (uploaded_by);
create index if not exists fixtures_opponent_id_idx       on public.fixtures (opponent_id);
create index if not exists fixtures_competition_id_idx    on public.fixtures (competition_id);
create index if not exists fixtures_pinned_image_id_idx   on public.fixtures (pinned_image_id);
create index if not exists results_motm_profile_id_idx    on public.results (motm_profile_id);
create index if not exists goals_scorer_profile_id_idx    on public.goals (scorer_profile_id);
create index if not exists goals_assist_profile_id_idx    on public.goals (assist_profile_id);
create index if not exists league_tables_club_id_idx      on public.league_tables (club_id);
create index if not exists league_tables_season_id_idx    on public.league_tables (season_id);
create index if not exists league_tables_competition_id_idx on public.league_tables (competition_id);
create index if not exists league_tables_team_id_idx      on public.league_tables (team_id);
create index if not exists payments_profile_id_idx        on public.payments (profile_id);
create index if not exists announcements_created_by_idx   on public.announcements (created_by);
create index if not exists lineups_profile_id_idx         on public.lineups (profile_id);
create index if not exists sponsors_club_id_idx           on public.sponsors (club_id);
create index if not exists client_errors_club_id_idx      on public.client_errors (club_id);
create index if not exists client_errors_profile_id_idx   on public.client_errors (profile_id);
create index if not exists competitions_club_id_idx       on public.competitions (club_id);
create index if not exists competition_squads_profile_id_idx on public.competition_squads (profile_id);
create index if not exists competition_squads_season_id_idx  on public.competition_squads (season_id);

-- ---------------------------------------------------------------------------
-- 4) History purge jobs (weekly, Sunday early morning UTC)
-- cron.schedule with an existing jobname updates it in place, so re-running
-- this migration is safe.
-- ---------------------------------------------------------------------------

-- pg_cron's own run ledger grows forever (one row per run-reminders hour).
select cron.schedule(
  'purge-cron-history',
  '10 3 * * 0',
  $$ delete from cron.job_run_details where end_time < now() - interval '30 days' $$
);

-- Client error log: 90-day retention (the SW noise is filtered client-side
-- since c31318a, so what remains is real and worth keeping for a season's arc).
select cron.schedule(
  'purge-client-errors',
  '20 3 * * 0',
  $$ delete from public.client_errors where created_at < now() - interval '90 days' $$
);
