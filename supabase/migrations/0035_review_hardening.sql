-- ============================================================================
-- Migration 0035: backend review hardening (findings D, E, F1–F6)
-- ----------------------------------------------------------------------------
-- Idempotent: every object is drop-if-exists / create-or-replace, so it can be
-- re-run. Every new policy wraps its per-request-constant calls in (select …)
-- (the 0031 initplan convention); every new function pins search_path (0032).
-- Verify with supabase/tests/rls_test.sql — T18–T25 cover this file.
--
--  D) anonymise_and_delete_profile(target, caller_club) — the admin-delete-player
--     Edge Function used to fire five UNCHECKED update statements (goals scorer /
--     assist, results motm, media uploaded_by, announcements created_by) plus a
--     payments delete, THEN delete the profile. A failure half-way stripped the
--     player's stats of their profile link without removing the player. Now one
--     security-definer plpgsql function does snapshot → null → delete in a single
--     transaction, refuses a profile outside the caller's club, and is callable
--     by service_role ONLY (revoked from public / anon / authenticated).
--
--  E) reminders_sent is keyed (fixture_id, hours_before, kind) and was never
--     re-armed when a fixture moved: reschedule a game and every offset already
--     sent for the OLD date stayed "sent", so nobody was reminded for the new
--     one. An AFTER UPDATE OF match_date, kickoff trigger clears the fixture's
--     ledger rows when either actually changed.
--
--  F1) team_memberships: memberships_select was `auth.uid() is not null` (any
--      signed-in user of ANY club could list every squad) and
--      memberships_admin_write was an unscoped is_admin. Both are now scoped to
--      the caller's club through the team's club_id.
--  F2) The security-definer policy helpers were EXECUTE-able by anon (default
--      PUBLIC grant). Revoked from public + anon; authenticated + service_role
--      keep it (the policies run as the caller).
--  F3) competition_squad_guard counted then inserted — two concurrent
--      registrations could both see limit-1 and both land. A transaction-scoped
--      advisory lock per competition serialises them.
--  F4) media_admin_update on storage.objects: 0031 rewrote its USING but not
--      its WITH CHECK, which still called is_admin() per row. Re-created with
--      both wrapped.
--  F5) profile_private.email was self-editable through the update policy, and
--      it mirrors the LOGIN email (auth.users) — drifting it breaks the admin
--      duplicate-email check and the "which login is this" answer. A trigger
--      now holds it for non-admin, non-service callers (phone/dob/ec_* stay
--      self-service, as the You page needs).
--  F6) profiles.photo_url accepted any string — an external tracker URL, a
--      javascript:/data: URL — rendered as an <img> for the whole club. It is
--      now constrained to this project's public media bucket (all 21 live
--      photos already match).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- D) anonymise_and_delete_profile(target uuid, caller_club uuid) → jsonb
-- ---------------------------------------------------------------------------
-- Snapshot columns line up with 0019 (lineups.player_name) and the *_name
-- fallbacks on goals / results: where a name is already there it is kept,
-- where it is empty the profile's "First Last" is written before the link is
-- nulled — so a since-deleted player still reads correctly in every stat.
-- Cascades (availability, team_memberships, push_tokens, competition_squads,
-- profile_private) and set-nulls (lineups, client_errors) ride the FKs.
drop function if exists public.anonymise_and_delete_profile(uuid, uuid);
create function public.anonymise_and_delete_profile(target uuid, caller_club uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club uuid; v_first text; v_last text; v_name text;
  n_scorer int; n_assist int; n_motm int; n_lineups int; n_media int; n_news int; n_pay int; n_prof int;
begin
  select club_id, first_name, last_name into v_club, v_first, v_last
    from profiles where id = target;
  if not found then
    raise exception 'Profile % not found', target using errcode = 'no_data_found';
  end if;
  if caller_club is null or v_club is distinct from caller_club then
    raise exception 'Profile % belongs to another club', target using errcode = 'insufficient_privilege';
  end if;
  v_name := nullif(btrim(coalesce(v_first, '') || ' ' || coalesce(v_last, '')), '');

  -- 1) Snapshot the name where a restrict FK would otherwise block the delete,
  --    then null the link. Existing free-typed names win.
  update goals
     set scorer_name = coalesce(nullif(btrim(scorer_name), ''), v_name), scorer_profile_id = null
   where scorer_profile_id = target;
  get diagnostics n_scorer = row_count;

  update goals
     set assist_name = coalesce(nullif(btrim(assist_name), ''), v_name), assist_profile_id = null
   where assist_profile_id = target;
  get diagnostics n_assist = row_count;

  update results
     set motm_name = coalesce(nullif(btrim(motm_name), ''), v_name), motm_profile_id = null
   where motm_profile_id = target;
  get diagnostics n_motm = row_count;

  -- lineups.profile_id goes null by FK (0019); make sure the name is there first.
  update lineups
     set player_name = coalesce(nullif(btrim(player_name), ''), v_name)
   where profile_id = target;
  get diagnostics n_lineups = row_count;

  update media_assets set uploaded_by = null where uploaded_by = target;
  get diagnostics n_media = row_count;

  update announcements set created_by = null where created_by = target;
  get diagnostics n_news = row_count;

  -- 2) Subs / payment records are operational, not history — remove them.
  delete from payments where profile_id = target;
  get diagnostics n_pay = row_count;

  -- 3) The profile itself (cascades the rest).
  delete from profiles where id = target;
  get diagnostics n_prof = row_count;
  if n_prof <> 1 then
    raise exception 'Profile % was not deleted', target using errcode = 'no_data_found';
  end if;

  -- Counts only — never the name — so the Edge Function can log the result.
  return jsonb_build_object(
    'deleted', true,
    'goals_scorer', n_scorer, 'goals_assist', n_assist, 'motm', n_motm,
    'lineups', n_lineups, 'media', n_media, 'announcements', n_news, 'payments', n_pay
  );
end;
$$;

revoke execute on function public.anonymise_and_delete_profile(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.anonymise_and_delete_profile(uuid, uuid) to service_role;

comment on function public.anonymise_and_delete_profile(uuid, uuid) is
  'admin-delete-player only (service_role). Snapshots names onto goals/results/lineups, nulls the links, drops payments and deletes the profile — in one transaction. Refuses a profile outside caller_club.';


-- ---------------------------------------------------------------------------
-- E) Re-arm reminders when a fixture is rescheduled
-- ---------------------------------------------------------------------------
-- security definer because reminders_sent has RLS with NO policies and no
-- grant to authenticated (0008): the admin's fixture edit runs as
-- `authenticated`, which could not touch the ledger itself.
create or replace function public.rearm_fixture_reminders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from reminders_sent where fixture_id = new.id;
  return null;   -- AFTER trigger; return value ignored
end;
$$;

drop trigger if exists rearm_fixture_reminders on public.fixtures;
create trigger rearm_fixture_reminders
  after update of match_date, kickoff on public.fixtures
  for each row
  when (old.match_date is distinct from new.match_date or old.kickoff is distinct from new.kickoff)
  execute function public.rearm_fixture_reminders();


-- ---------------------------------------------------------------------------
-- F1) team_memberships — club-scoped read and admin write
-- ---------------------------------------------------------------------------
drop policy if exists memberships_select on public.team_memberships;
create policy memberships_select on public.team_memberships
  for select to authenticated
  using (exists (select 1 from public.teams t
                 where t.id = team_memberships.team_id
                   and t.club_id = (select current_club_id())));

drop policy if exists memberships_admin_write on public.team_memberships;
create policy memberships_admin_write on public.team_memberships
  for all to authenticated
  using ((select is_admin(auth.uid()))
         and exists (select 1 from public.teams t
                     where t.id = team_memberships.team_id
                       and t.club_id = (select current_club_id())))
  with check ((select is_admin(auth.uid()))
              and exists (select 1 from public.teams t
                          where t.id = team_memberships.team_id
                            and t.club_id = (select current_club_id())));


-- ---------------------------------------------------------------------------
-- F2) Policy helpers: not for anon
-- ---------------------------------------------------------------------------
-- Signatures per 0001 (is_admin, current_club_id, can_select_fixture),
-- 0009 (is_active_player), 0030 (is_approved_member),
-- 0034 (can_respond_to_fixture, fixture_open_for_responses).
-- Explicit re-grant to authenticated + service_role: revoking from PUBLIC
-- would otherwise take it from them too, and every RLS policy calls these as
-- the requesting role.
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.is_admin(uuid)',
    'public.is_active_player(uuid)',
    'public.is_approved_member(uuid)',
    'public.can_respond_to_fixture(uuid, uuid)',
    'public.fixture_open_for_responses(uuid)',
    'public.current_club_id()',
    'public.can_select_fixture(uuid, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- F3) competition_squad_guard — serialise registrations per competition
-- ---------------------------------------------------------------------------
create or replace function public.competition_squad_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_enabled boolean; v_limit int; v_season uuid; v_count int;
begin
  -- Transaction-scoped lock keyed on the competition: two registrations for
  -- the same squad queue behind each other, so the count below is exact.
  -- Released automatically at commit / rollback.
  perform pg_advisory_xact_lock(hashtext(new.competition_id::text));

  select squad_limit_enabled, squad_limit, season_id into v_enabled, v_limit, v_season
    from competitions where id = new.competition_id;
  new.season_id := v_season;  -- always mirror the competition's season
  if v_enabled and v_limit is not null then
    select count(*) into v_count from competition_squads where competition_id = new.competition_id;
    if v_count >= v_limit then
      raise exception 'Squad is full (% of % registered)', v_count, v_limit using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
-- The trigger itself (0028) is unchanged; re-created here so the file stands alone.
drop trigger if exists competition_squad_guard on public.competition_squads;
create trigger competition_squad_guard before insert on public.competition_squads
  for each row execute function public.competition_squad_guard();


-- ---------------------------------------------------------------------------
-- F4) media_admin_update — WITH CHECK initplan-wrapped too
-- ---------------------------------------------------------------------------
drop policy if exists media_admin_update on storage.objects;
create policy media_admin_update on storage.objects
  for update to authenticated
  using ((bucket_id = 'media') and (select public.is_admin(auth.uid())))
  with check ((bucket_id = 'media') and (select public.is_admin(auth.uid())));


-- ---------------------------------------------------------------------------
-- F5) profile_private.email is the login email — not self-service
-- ---------------------------------------------------------------------------
-- Same shape as protect_profile_columns (0001/0009): NOT security definer so
-- current_user is the real caller; backend roles pass; a non-admin's change
-- to email is silently reverted (the row update itself still succeeds, so a
-- phone / emergency-contact edit in the same statement lands).
create or replace function public.protect_private_email()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres','supabase_admin','service_role','supabase_auth_admin') then
    return new;
  end if;
  if not is_admin(auth.uid()) then
    new.email := old.email;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_private_email on public.profile_private;
create trigger protect_private_email
  before update on public.profile_private
  for each row execute function public.protect_private_email();


-- ---------------------------------------------------------------------------
-- F6) profiles.photo_url must point at this project's public media bucket
-- ---------------------------------------------------------------------------
-- The app writes exactly this shape (src/lib/storage.js → getPublicUrl on the
-- 'media' bucket). Any Supabase project ref is accepted so staging works.
alter table public.profiles drop constraint if exists profiles_photo_url_check;
alter table public.profiles add constraint profiles_photo_url_check
  check (photo_url is null
         or photo_url ~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/media/');

-- ============================================================================
-- End migration 0035
-- ============================================================================
