-- ============================================================================
-- Migration 0037: security audit / pen-test remediation
-- ----------------------------------------------------------------------------
-- Idempotent: every statement is drop-if-exists / if-not-exists / a plain
-- revoke, so it can be re-run. New policies keep the 0031 initplan convention.
-- Verify with supabase/tests/rls_test.sql — T26-T30 cover this file.
--
-- Nothing here fixes an exploited hole: the RLS surface came through the audit
-- clean (every policy is scoped `to authenticated`, no table has RLS off, and
-- the only RLS-enabled-no-policy table is reminders_sent, which is deliberate).
-- These are the latent ones - the grants and missing constraints that are
-- harmless today and would not be after the multi-tenant Beta, plus the two
-- URL-shaped injection surfaces 0035 F6 closed for profiles.photo_url only.
--
--  A) NOT FIXED HERE, ON PURPOSE - see the note in section A below. pg_net's
--     net.http_* functions are EXECUTE-able by `anon` and `authenticated`, but
--     they are owned by supabase_admin and cannot be revoked from the postgres
--     role this migration runs as. The compensating control is a dashboard
--     setting, not SQL.
--
--  B) The trigger functions (handle_new_user, protect_profile_columns,
--     protect_private_email, rearm_fixture_reminders, competition_squad_guard,
--     touch_updated_at) carried the default PUBLIC execute grant, so the
--     Supabase linter flags them at /rest/v1/rpc/<name>. A trigger-returning
--     function refuses a direct call, but two of them are SECURITY DEFINER and
--     none of them should be in the API surface at all. 0035 F2 did this for
--     the policy helpers; this finishes the set.
--
--  C) reminders_sent is RLS-enabled with no policies (fail-closed, by design -
--     it is the reminder ledger and only run-reminders touches it, as the
--     service role). It nonetheless carried Supabase's default table grants to
--     anon and authenticated, so it was one accidental `disable row level
--     security` away from being world-writable. Revoke the grant too: the
--     table is then shut by privilege AND by RLS.
--
--  D) 0035 F6 constrained profiles.photo_url to this project's media bucket
--     because an arbitrary string there is rendered as an <img> for the whole
--     club (external tracker, data: URL, IP-logging beacon). The same is true
--     of five more columns it didn't cover. All 55 live values across them
--     already match the pattern, so this is a no-op on real data.
--
--  E) Two admin branches were not club-scoped: profiles_update and
--     availability_delete both said `is_admin(auth.uid())` with nothing tying
--     the row to the admin's own club. is_admin() is global, so in the
--     multi-tenant Beta an admin of club A could rewrite club B's profiles or
--     wipe its availability. Every other admin policy already carries the club
--     term; these two were the gap.
--
--  F) protect_profile_columns stops you demoting or deactivating YOURSELF; it
--     did not stop you moving yourself to another club. With (E) in place an
--     admin can no longer touch another club's rows - but could still have
--     walked their own account across. Same lockout-guard shape, third rule.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- A) pg_net (net.http_get / http_post / http_delete) — NO SQL FIX AVAILABLE
-- ---------------------------------------------------------------------------
-- pg_net issues HTTP requests FROM the database, which sits inside Supabase's
-- network. All 12 functions in the `net` schema carry the default PUBLIC
-- EXECUTE grant (`=X/supabase_admin`), so `anon` and `authenticated` can call
-- them — an SSRF primitive if it were ever reachable.
--
-- It is NOT reachable today, and the reason is the control:
--   * PostgREST only routes /rest/v1/rpc/<fn> for functions in the EXPOSED
--     schemas, which for this project are `public` and `graphql_public`.
--     `net` is not among them, so there is no HTTP route to net.http_post.
--   * Nothing in `public` calls net.*; only the pg_cron job that fires
--     run-reminders does, and cron runs as `postgres`.
--
-- The revoke cannot be written here: both the `net` schema and its functions
-- are owned by `supabase_admin`, and a REVOKE issued by `postgres` (which is
-- what this migration runs as, in the SQL editor or via the MCP) is a silent
-- no-op. Verified 2026-09-25.
--
-- WHAT TO DO INSTEAD, and keep doing:
--   Dashboard → Project Settings → Data API → "Exposed schemas" must stay
--   `public, graphql_public`. Never add `net`. If pg_net is not actually
--   needed, `drop extension pg_net` removes the primitive altogether — but
--   the run-reminders cron job posts through it, so check that first.
--
-- Left as a comment rather than dropped, so the next audit finds the reasoning
-- instead of re-deriving it.


-- ---------------------------------------------------------------------------
-- B) Trigger functions: out of the exposed API surface
-- ---------------------------------------------------------------------------
do $do$
declare fn text;
begin
  foreach fn in array array[
    'public.handle_new_user()',
    'public.protect_private_email()',
    'public.rearm_fixture_reminders()',
    'public.competition_squad_guard()',
    'public.touch_updated_at()'
  ] loop
    -- A trigger fires with the privileges of the statement that fired it, not
    -- via an EXECUTE grant, so revoking from everyone leaves the triggers
    -- working exactly as before.
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
  end loop;
end $do$;
-- protect_profile_columns is re-created in (F) below and revoked there.


-- ---------------------------------------------------------------------------
-- C) reminders_sent: shut by privilege as well as by RLS
-- ---------------------------------------------------------------------------
revoke all on public.reminders_sent from anon, authenticated;

comment on table public.reminders_sent is
  'Reminder ledger. run-reminders (service_role) only: RLS is on with NO policies AND the anon/authenticated grants are revoked, so it is closed twice over. Do not add a policy without a reason.';


-- ---------------------------------------------------------------------------
-- D) Every rendered image URL must point at this project's media bucket
-- ---------------------------------------------------------------------------
-- Same pattern as profiles_photo_url_check (0035 F6); any project ref is
-- accepted so staging works.
do $do$
declare
  pair text[];
  pairs text[][] := array[
    array['sponsors',     'logo_url'],
    array['opponents',    'badge_url'],
    array['clubs',        'crest_url'],
    array['media_assets', 'url'],
    array['results',      'motm_photo_url']
  ];
begin
  foreach pair slice 1 in array pairs loop
    execute format('alter table public.%I drop constraint if exists %I',
                   pair[1], pair[1] || '_' || pair[2] || '_check');
    execute format(
      'alter table public.%I add constraint %I check (%I is null or %I ~ %L)',
      pair[1], pair[1] || '_' || pair[2] || '_check', pair[2], pair[2],
      '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/media/');
  end loop;
end $do$;

-- sponsors.website is deliberately NOT constrained: it is an external site,
-- rendered as an <a href> and not an <img src>, and the live values are stored
-- scheme-less. sponsorWebsite() in src/hooks/useSponsors.js forces an https://
-- prefix onto anything that isn't already http(s), so a javascript: or data:
-- value can never reach the href. src/hooks/useSponsors.test.js pins that.


-- ---------------------------------------------------------------------------
-- E) Club-scope the two unscoped admin branches
-- ---------------------------------------------------------------------------
-- profiles_update: self, or an admin of the SAME club. WITH CHECK carries the
-- club term too, so an admin cannot move a profile out of their club either.
alter policy profiles_update on public.profiles
  using ((id = (select auth.uid()))
         or ((select is_admin(auth.uid())) and club_id = (select current_club_id())))
  with check ((id = (select auth.uid()))
              or ((select is_admin(auth.uid())) and club_id = (select current_club_id())));

-- availability_delete: own row, or an admin of the club that owns the fixture.
-- Still no team or kickoff term - withdrawing an answer must always work
-- (0034 section 3); this only stops a DELETE crossing a club boundary.
alter policy availability_delete on public.availability
  using ((profile_id = (select auth.uid()))
         or ((select is_admin(auth.uid()))
             and exists (select 1 from public.fixtures f
                         where f.id = availability.fixture_id
                           and f.club_id = (select current_club_id()))));


-- ---------------------------------------------------------------------------
-- F) Lockout guard, third rule: nobody walks their own account to another club
-- ---------------------------------------------------------------------------
-- Unchanged from 0009 apart from the new self-club check. Still NOT security
-- definer, so current_user is the real caller and the backend roles bypass -
-- that is how the first admin is bootstrapped by hand.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if current_user in ('postgres','supabase_admin','service_role','supabase_auth_admin') then return new; end if;
  if not is_admin(auth.uid()) then
    new.role := old.role; new.xl_eligible := old.xl_eligible; new.active := old.active;
    new.club_id := old.club_id; new.approved := old.approved; new.is_player := old.is_player;
  end if;
  if new.id = auth.uid() then
    if old.role = 'admin' and new.role is distinct from old.role then raise exception 'You cannot change your own admin role'; end if;
    if old.active = true and new.active = false then raise exception 'You cannot deactivate your own account'; end if;
    -- An admin passes the not-is_admin block above, so without this they could
    -- carry their own account (and its admin role) into another club.
    if new.club_id is distinct from old.club_id then raise exception 'You cannot move your own account to another club'; end if;
  end if;
  return new;
end; $fn$;

revoke execute on function public.protect_profile_columns() from public, anon, authenticated;

drop trigger if exists protect_profile_columns on public.profiles;
create trigger protect_profile_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- ============================================================================
-- End migration 0037
-- ============================================================================
