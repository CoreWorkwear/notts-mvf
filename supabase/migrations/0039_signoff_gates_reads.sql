-- ============================================================================
-- Migration 0039: sign-off gates reads, and the rest of the November review
-- ----------------------------------------------------------------------------
-- Run in the Supabase SQL Editor AFTER 0038, then run supabase/tests/rls_test.sql
-- (T32-T45 cover this file). Deploy the Edge Functions from the same commit
-- alongside it: admin-delete-player and send-push lean on sections G and H.
--
-- WHY. Approval used to protect writes only. Every read policy keyed off
-- current_club_id(), which returned a club for ANY profile row, so anyone who
-- signed up through the public "Join up" tab could read the squad, every
-- availability answer, line-ups and who had paid subs before a manager had
-- looked at them. Supporters were never signed off at all, so for them that
-- state was permanent. A removed (inactive) player kept the same reads.
--
-- THE RULE NOW (product decision, Nov 2026): nobody reads club data until a
-- manager signs them off, supporters included. Managers are exempt (the first
-- admin is bootstrapped by hand and may never have been flagged approved).
-- A pending or removed account can still read its own profile and private row,
-- so the app can show it a "waiting on the manager" screen.
--
-- EXISTING SUPPORTERS ARE GRANDFATHERED (club decision, Nov 2026). Every
-- supporter on live is approved = false, because nothing ever approved one.
-- Section A0 signs off every ACTIVE supporter that exists when this runs, just
-- before the gate goes on, so none of them is locked out for a moment. The
-- count is raised as a NOTICE. Pending players are NOT touched; removed
-- supporters stay removed; anyone who signs up as a supporter from here on
-- needs a manager's sign-off like a player. To see who was waved through:
--   select id, first_name, last_name, created_at from profiles
--    where not is_player and active and approved order by created_at;
--
-- PROJECTS: section J pins image URLs to the live and staging project refs. A
-- new project must add its ref to media_url_ok() or its uploads are refused.
--
-- Sections:
--   A0 grandfather the supporters that exist today (data, runs before the gate)
--   A  own_club_id(): the caller's club whatever their status (attribution only)
--   B  current_club_id(): approved-or-manager AND active, the gate for all reads
--   C  own-row reads for pending/removed accounts (profiles, memberships)
--   D  storage: listing gated; self-uploads only into players/<own uid>/; jpeg/png/webp
--   E  line-ups and can_select_fixture: club-scoped admin branch, approval gate
--   F  client_errors: attribution forced server-side, per-profile hourly cap,
--      the NULL-context bug, club-scoped manager read/delete
--   G  anonymise_and_delete_profile refuses a manager
--   H  push_tokens: real push endpoints only, 10 per profile, one owner per token
--   I  name and requested-squad length limits
--   J  image URL columns pinned to this project
--   K  manager writes can't reference another club's rows
--   L  anon: no table privileges, no function execute, now or for new objects
--   M  housekeeping: one current season per club, fixture indexes, dead indexes
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A0) Grandfather today's supporters (see the header). Runs as postgres from
--     the SQL Editor, which protect_profile_columns lets change `approved`.
--     Supporters only: is_player = false. Pending PLAYERS stay pending.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  update public.profiles
     set approved = true
   where not is_player and active and not approved;
  get diagnostics n = row_count;
  raise notice '0039: % existing supporter account(s) grandfathered (approved)', n;
end $$;

-- ---------------------------------------------------------------------------
-- A) own_club_id(): the caller's club with no status check. Used ONLY to
--    attribute rows the caller writes about themselves (client_errors), never
--    to decide what they may read.
-- ---------------------------------------------------------------------------
create or replace function public.own_club_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select club_id from profiles where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- B) current_club_id(): the one gate every club read goes through.
-- ---------------------------------------------------------------------------
create or replace function public.current_club_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select club_id from profiles
   where id = auth.uid()
     and active
     and (approved or role = 'admin');
$$;

-- ---------------------------------------------------------------------------
-- C) Own-row reads survive the gate.
-- ---------------------------------------------------------------------------
alter policy profiles_select on public.profiles
  using ((club_id = (select current_club_id())) or (id = (select auth.uid())));

-- Own memberships only inside your own club's teams: a row left behind in
-- another club's team (an account moved between clubs) stays hidden. The
-- team's club is looked up through a definer function because teams itself is
-- hidden from a pending account, and a subquery in a policy obeys RLS.
create or replace function public.team_club_id(_team_id uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select club_id from teams where id = _team_id;
$$;

alter policy memberships_select on public.team_memberships
  using ((exists (select 1 from public.teams t
                   where t.id = team_memberships.team_id
                     and t.club_id = (select current_club_id())))
         or (profile_id = (select auth.uid())
             and team_club_id(team_id) = (select own_club_id())));

-- ---------------------------------------------------------------------------
-- D) Storage.
-- ---------------------------------------------------------------------------
-- Listing: signed-off members only (public URLs still download for anyone,
-- which is what the bucket being public is for).
drop policy if exists media_public_read on storage.objects;
create policy media_public_read on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and (select current_club_id()) is not null);

-- Self-uploads: an approved member may add files only under players/<own uid>/.
-- Managers upload anywhere through media_admin_insert.
drop policy if exists media_players_folder_insert on storage.objects;
create policy media_players_folder_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'players'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and (select is_approved_member(auth.uid()))
  );

-- The app always uploads image/jpeg (src/lib/storage.js). image/* let SVG in.
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'media';

-- ---------------------------------------------------------------------------
-- E) Fixture visibility. The admin branch was not tied to a club, and
--    lineups_select had no club term of its own, so a manager of ANY club could
--    read every club's line-ups. Visibility now needs: same club, active, and
--    signed off or a manager. Still club-wide, never team-scoped (see 0023).
-- ---------------------------------------------------------------------------
create or replace function public.can_select_fixture(_fixture_id uuid, _uid uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
      from fixtures f
      join profiles p on p.id = _uid
     where f.id = _fixture_id
       and p.active
       and (p.approved or p.role = 'admin')
       and p.club_id = f.club_id
  );
$$;

alter policy lineups_select on public.lineups
  using (exists (select 1 from public.fixtures fx
                  where fx.id = lineups.fixture_id
                    and fx.club_id = (select current_club_id()))
         and can_select_fixture(fixture_id, (select auth.uid())));

-- ---------------------------------------------------------------------------
-- F) client_errors.
-- ---------------------------------------------------------------------------
-- A BEFORE trigger fills in who and which club from the session, so no row is
-- ever unattributed, and silently drops a row once the profile has logged 60
-- in the last hour (the client caps itself at 30). Returning NULL skips the
-- row without an error, so a flooding client gets nothing to retry on.
create or replace function public.client_errors_before_insert()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  new.profile_id := coalesce(new.profile_id, auth.uid());
  new.club_id    := coalesce(new.club_id, own_club_id());
  if new.profile_id is not null and (
       select count(*) from client_errors
        where profile_id = new.profile_id
          and created_at > now() - interval '1 hour') >= 60 then
    return null;
  end if;
  return new;
end;
$$;
revoke all on function public.client_errors_before_insert() from public, anon, authenticated;

drop trigger if exists client_errors_before_insert on public.client_errors;
create trigger client_errors_before_insert
  before insert on public.client_errors
  for each row execute function public.client_errors_before_insert();

create index if not exists client_errors_profile_recent
  on public.client_errors (profile_id, created_at desc);

-- The cap check is coalesced: pg_column_size(NULL) is NULL, and a NULL in a
-- WITH CHECK refuses the row, so every error logged without context was being
-- thrown away (and the harness could never get past T26). Attribution must
-- match the caller; a pending account may log against its own club.
drop policy if exists client_errors_insert on public.client_errors;
create policy client_errors_insert on public.client_errors
  for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and club_id is not distinct from (select own_club_id())
    and length(coalesce(kind, ''))       <= 40
    and length(coalesce(message, ''))    <= 1000
    and length(coalesce(url, ''))        <= 500
    and length(coalesce(user_agent, '')) <= 500
    and coalesce(pg_column_size(context), 0) <= 8192
  );

alter policy client_errors_admin_read on public.client_errors
  using ((select is_admin(auth.uid())) and club_id = (select current_club_id()));
alter policy client_errors_admin_delete on public.client_errors
  using ((select is_admin(auth.uid())) and club_id = (select current_club_id()));

-- ---------------------------------------------------------------------------
-- G) anonymise_and_delete_profile: a manager can't be deleted. One compromised
--    manager login could otherwise wipe every other manager, the hand-made
--    first admin included, with no undo. Take the role off first (Players),
--    which protect_profile_columns already lets another manager do.
--    Body otherwise identical to 0035.
-- ---------------------------------------------------------------------------
create or replace function public.anonymise_and_delete_profile(target uuid, caller_club uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_club uuid; v_first text; v_last text; v_name text; v_role text;
  n_scorer int; n_assist int; n_motm int; n_lineups int; n_media int; n_news int; n_pay int; n_prof int;
begin
  select club_id, first_name, last_name, role into v_club, v_first, v_last, v_role
    from profiles where id = target;
  if not found then
    raise exception 'Profile % not found', target using errcode = 'no_data_found';
  end if;
  if caller_club is null or v_club is distinct from caller_club then
    raise exception 'Profile % belongs to another club', target using errcode = 'insufficient_privilege';
  end if;
  if v_role = 'admin' then
    raise exception 'Profile % is a manager; take the manager role off first', target
      using errcode = 'insufficient_privilege';
  end if;
  v_name := nullif(btrim(coalesce(v_first, '') || ' ' || coalesce(v_last, '')), '');

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

  update lineups
     set player_name = coalesce(nullif(btrim(player_name), ''), v_name)
   where profile_id = target;
  get diagnostics n_lineups = row_count;

  update media_assets set uploaded_by = null where uploaded_by = target;
  get diagnostics n_media = row_count;

  update announcements set created_by = null where created_by = target;
  get diagnostics n_news = row_count;

  delete from payments where profile_id = target;
  get diagnostics n_pay = row_count;

  delete from profiles where id = target;
  get diagnostics n_prof = row_count;
  if n_prof <> 1 then
    raise exception 'Profile % was not deleted', target using errcode = 'no_data_found';
  end if;

  return jsonb_build_object(
    'deleted', true,
    'goals_scorer', n_scorer, 'goals_assist', n_assist, 'motm', n_motm,
    'lineups', n_lineups, 'media', n_media, 'announcements', n_news, 'payments', n_pay
  );
end;
$$;
revoke all on function public.anonymise_and_delete_profile(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.anonymise_and_delete_profile(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- H) push_tokens. token is the browser's PushSubscription as JSON. Anything
--    that isn't a real push service would have every broadcast and hourly
--    reminder POSTing from Supabase's servers to a host of the member's choice.
--    Same host rule as supabase/functions/_shared/push.js isAllowedPushEndpoint.
-- ---------------------------------------------------------------------------
create or replace function public.push_token_ok(token text)
returns boolean
language plpgsql immutable
set search_path = public
as $$
declare s jsonb;
begin
  s := token::jsonb;
  return jsonb_typeof(s) = 'object'
     and coalesce(s->>'endpoint', '') ~* (
           '^https://('
        || 'fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com'
        || '|[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.apple\.com'
        || '|[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com'
        || ')/')
     and coalesce(s #>> '{keys,p256dh}', '') <> ''
     and coalesce(s #>> '{keys,auth}', '')   <> '';
exception when others then
  return false;
end;
$$;

-- NOT VALID: existing rows aren't re-checked here (send-push prunes the bad
-- ones on the next send); every new or changed row is.
alter table public.push_tokens drop constraint if exists push_tokens_token_is_push_endpoint;
alter table public.push_tokens
  add constraint push_tokens_token_is_push_endpoint check (push_token_ok(token)) not valid;

-- One device, one owner (a shared phone hands its subscription to whoever
-- signed in last), and at most 10 per profile: the oldest go, so a genuine
-- player on a new phone is never refused.
create or replace function public.push_tokens_after_insert()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  delete from push_tokens where token = new.token and profile_id <> new.profile_id;
  delete from push_tokens
   where id in (select id from push_tokens
                 where profile_id = new.profile_id
                 order by created_at desc, id desc
                 offset 10);
  return null;
end;
$$;
revoke all on function public.push_tokens_after_insert() from public, anon, authenticated;

drop trigger if exists push_tokens_after_insert on public.push_tokens;
create trigger push_tokens_after_insert
  after insert on public.push_tokens
  for each row execute function public.push_tokens_after_insert();

create index if not exists push_tokens_token_idx on public.push_tokens (token);

-- ---------------------------------------------------------------------------
-- I) Self-editable free text gets a ceiling. NOT VALID so an odd existing row
--    can't fail the migration; new writes are checked.
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_first_name_len;
alter table public.profiles drop constraint if exists profiles_last_name_len;
alter table public.profiles drop constraint if exists profiles_requested_teams_len;
alter table public.profiles add constraint profiles_first_name_len
  check (first_name is null or char_length(first_name) <= 60) not valid;
alter table public.profiles add constraint profiles_last_name_len
  check (last_name is null or char_length(last_name) <= 60) not valid;
alter table public.profiles add constraint profiles_requested_teams_len
  check (requested_teams is null or cardinality(requested_teams) <= 10) not valid;

-- ---------------------------------------------------------------------------
-- J) Image URLs: THIS project's public media bucket, not any Supabase
--    project's. With any ref allowed, a member could point photo_url at their
--    own project and log the IP of everyone who opened the squad list.
--    Live (vgeosccpwsdosbcnpcve) and staging (mqmvnmbsyvwrxlnlgive); a new
--    project adds its ref to the alternation below.
-- ---------------------------------------------------------------------------
create or replace function public.media_url_ok(u text)
returns boolean
language sql immutable
set search_path = public
as $$
  select u is null
      or u ~ '^https://(vgeosccpwsdosbcnpcve|mqmvnmbsyvwrxlnlgive)\.supabase\.co/storage/v1/object/public/media/';
$$;

alter table public.profiles      drop constraint if exists profiles_photo_url_check;
alter table public.sponsors      drop constraint if exists sponsors_logo_url_check;
alter table public.opponents     drop constraint if exists opponents_badge_url_check;
alter table public.clubs         drop constraint if exists clubs_crest_url_check;
alter table public.media_assets  drop constraint if exists media_assets_url_check;
alter table public.results       drop constraint if exists results_motm_photo_url_check;
alter table public.profiles      add constraint profiles_photo_url_check      check (media_url_ok(photo_url)) not valid;
alter table public.sponsors      add constraint sponsors_logo_url_check       check (media_url_ok(logo_url)) not valid;
alter table public.opponents     add constraint opponents_badge_url_check     check (media_url_ok(badge_url)) not valid;
alter table public.clubs         add constraint clubs_crest_url_check         check (media_url_ok(crest_url)) not valid;
alter table public.media_assets  add constraint media_assets_url_check        check (media_url_ok(url)) not valid;
alter table public.results       add constraint results_motm_photo_url_check  check (media_url_ok(motm_photo_url)) not valid;

-- ---------------------------------------------------------------------------
-- K) Manager writes stay inside the manager's club on BOTH ends: the row's own
--    parent (already checked) and the profile/team/season it points at. Only
--    bites with a second club; cheap to have before one exists.
-- ---------------------------------------------------------------------------
alter policy memberships_admin_write on public.team_memberships
  using ((select is_admin(auth.uid()))
         and exists (select 1 from public.teams t where t.id = team_memberships.team_id and t.club_id = (select current_club_id())))
  with check ((select is_admin(auth.uid()))
         and exists (select 1 from public.teams t where t.id = team_memberships.team_id and t.club_id = (select current_club_id()))
         and exists (select 1 from public.profiles p where p.id = team_memberships.profile_id and p.club_id = (select current_club_id())));

alter policy lineups_admin_write on public.lineups
  using ((select is_admin(auth.uid()))
         and exists (select 1 from public.fixtures fx where fx.id = lineups.fixture_id and fx.club_id = (select current_club_id())))
  with check ((select is_admin(auth.uid()))
         and exists (select 1 from public.fixtures fx where fx.id = lineups.fixture_id and fx.club_id = (select current_club_id()))
         and (lineups.profile_id is null
              or exists (select 1 from public.profiles p where p.id = lineups.profile_id and p.club_id = (select current_club_id()))));

alter policy competition_squads_admin_write on public.competition_squads
  using ((select is_admin(auth.uid()))
         and exists (select 1 from public.competitions c where c.id = competition_squads.competition_id and c.club_id = (select current_club_id())))
  with check ((select is_admin(auth.uid()))
         and exists (select 1 from public.competitions c where c.id = competition_squads.competition_id and c.club_id = (select current_club_id()))
         and exists (select 1 from public.profiles p where p.id = competition_squads.profile_id and p.club_id = (select current_club_id())));

alter policy payments_admin_write on public.payments
  using ((select is_admin(auth.uid()))
         and exists (select 1 from public.fixtures f where f.id = payments.fixture_id and f.club_id = (select current_club_id())))
  with check ((select is_admin(auth.uid()))
         and exists (select 1 from public.fixtures f where f.id = payments.fixture_id and f.club_id = (select current_club_id()))
         and exists (select 1 from public.profiles p where p.id = payments.profile_id and p.club_id = (select current_club_id())));

alter policy fixtures_admin_write on public.fixtures
  using ((club_id = (select current_club_id())) and (select is_admin(auth.uid())))
  with check ((club_id = (select current_club_id())) and (select is_admin(auth.uid()))
         and exists (select 1 from public.teams t   where t.id = fixtures.team_id   and t.club_id = fixtures.club_id)
         and exists (select 1 from public.seasons s where s.id = fixtures.season_id and s.club_id = fixtures.club_id)
         and (fixtures.opponent_id is null
              or exists (select 1 from public.opponents o where o.id = fixtures.opponent_id and o.club_id = fixtures.club_id))
         and (fixtures.competition_id is null
              or exists (select 1 from public.competitions c where c.id = fixtures.competition_id and c.club_id = fixtures.club_id)));

-- ---------------------------------------------------------------------------
-- L) anon. 0001 said "anon gets NOTHING", but Supabase's default privileges
--    grant ALL on every new public table, and EXECUTE on every new function to
--    PUBLIC (which anon inherits). RLS has been the only thing standing between
--    anon and the data. Take the privileges away too, now and for anything
--    created later. authenticated and service_role keep exactly what they had.
-- ---------------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;

do $$
declare
  f record; auth_had boolean; svc_had boolean;
begin
  for f in
    select p.oid, p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
  loop
    if has_function_privilege('anon', f.oid, 'execute') then
      auth_had := has_function_privilege('authenticated', f.oid, 'execute');
      svc_had  := has_function_privilege('service_role',  f.oid, 'execute');
      execute format('revoke execute on function %s from public, anon', f.sig);
      if auth_had then execute format('grant execute on function %s to authenticated', f.sig); end if;
      if svc_had  then execute format('grant execute on function %s to service_role',  f.sig); end if;
    end if;
  end loop;
end $$;

-- EXECUTE-to-PUBLIC on new functions is a GLOBAL default: an "in schema"
-- revoke can't remove it, so it goes without the schema clause. These apply to
-- objects postgres creates (everything run from the SQL Editor).
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public grant  execute on functions to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- M) Housekeeping.
-- ---------------------------------------------------------------------------
-- One current season per club. SeasonsPanel clears the others before setting
-- the new one, so the app never trips this. Skipped with a notice (not an
-- error) if a club already has two, so the rest of the migration still lands.
do $$
begin
  if exists (select club_id from public.seasons where is_current group by club_id having count(*) > 1) then
    raise notice '0039: a club has more than one current season; seasons_one_current_per_club NOT created. Fix the data in Manage > Seasons and re-run this block.';
  else
    create unique index if not exists seasons_one_current_per_club
      on public.seasons (club_id) where is_current;
  end if;
end $$;

-- Fixtures are fetched by season and by team; the composite leads on club_id.
create index if not exists fixtures_season_id_idx on public.fixtures (season_id);
create index if not exists fixtures_team_id_idx   on public.fixtures (team_id);

-- Both duplicate the leading column of an existing unique index.
drop index if exists public.availability_fixture_id_idx;
drop index if exists public.team_memberships_profile_id_idx;

-- ============================================================================
-- End migration 0039
-- ============================================================================
