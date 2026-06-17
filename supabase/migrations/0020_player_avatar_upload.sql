-- ============================================================================
-- Migration 0020: let players self-upload their avatar (§3.5 fix)
-- The media bucket was admin-write only, so a non-admin uploading their own
-- avatar hit "new row violates row-level security policy". Allow any
-- authenticated user to INSERT into the players/ folder (avatars + headshots).
-- Public read and admin-only UPDATE/DELETE are unchanged, so nobody can tamper
-- with or remove someone else's image.
-- ============================================================================

drop policy if exists media_players_folder_insert on storage.objects;
create policy media_players_folder_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = 'players');
