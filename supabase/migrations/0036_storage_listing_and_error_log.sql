-- ============================================================================
-- Migration 0036: close the last two API-surface findings (third healthcheck)
-- Idempotent; policies follow the 0031 initplan convention.
--
--  A) media_public_read had no `to` clause, so it defaulted to PUBLIC: anyone
--     holding the shipped anon key could call the storage LIST API and
--     enumerate every object in the bucket — players/<uuid>.jpg headshots
--     included — defeating 0003's own "unguessable paths" protection. The app
--     never lists (downloads go through /object/public/ URLs, which bypass
--     RLS on a public bucket), so scoping SELECT to authenticated club
--     members breaks nothing and stops anonymous enumeration.
--
--  B) client_errors_insert accepted any club_id (spoofable attribution) and
--     any row size (the logger truncates client-side, but the DB never
--     enforced it — a hostile signup could grow the table without limit).
--     Now: club_id must be null or the caller's own club, and every text /
--     jsonb column carries the same caps the logger applies.
-- ============================================================================

-- A) Storage listing: club members only.
drop policy if exists media_public_read on storage.objects;
create policy media_public_read on storage.objects
  for select to authenticated
  using (bucket_id = 'media');

-- B) client_errors: own club, capped sizes.
drop policy if exists client_errors_insert on public.client_errors;
create policy client_errors_insert on public.client_errors
  for insert to authenticated
  with check (
    (profile_id is null or profile_id = (select auth.uid()))
    and (club_id is null or club_id = (select current_club_id()))
    and length(coalesce(kind, ''))       <= 40
    and length(coalesce(message, ''))    <= 1000
    and length(coalesce(url, ''))        <= 500
    and length(coalesce(user_agent, '')) <= 500
    and pg_column_size(context)          <= 8192
  );

-- ============================================================================
-- End migration 0036
-- ============================================================================
