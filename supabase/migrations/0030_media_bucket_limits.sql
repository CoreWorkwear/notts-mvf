-- ============================================================================
-- Migration 0030: media bucket hardening (healthcheck)
-- The public media bucket had no size cap and no MIME allowlist, and the
-- players/ folder INSERT (0020) admitted ANY authenticated account — including
-- a brand-new unapproved signup, which could fill the storage quota with junk
-- that is then publicly served.
--   * 10 MB cap + images only, enforced at the bucket. The app uploads ~1200px
--     JPEGs well under 1 MB; the ceiling covers the raw-file fallback path
--     (canvas failed → original phone photo).
--   * players/ uploads now need an APPROVED, ACTIVE account. Supporters stay
--     allowed (they set their own avatar), so is_player is NOT required —
--     which is why this is a new helper rather than is_active_player.
-- Admin-only write elsewhere and public read are unchanged.
-- ============================================================================

update storage.buckets
set file_size_limit = 10485760,          -- 10 MB
    allowed_mime_types = array['image/*']
where id = 'media';

-- Approved + active member of any account type (player or supporter).
-- security definer like the other policy helpers, so it can read profiles
-- without recursing into that table's own RLS.
create or replace function public.is_approved_member(uid uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce((select approved and active from profiles where id = uid), false);
$$;

drop policy if exists media_players_folder_insert on storage.objects;
create policy media_players_folder_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'players'
    and is_approved_member(auth.uid())
  );
