-- ============================================================================
-- Migration 0003: Storage bucket + policies for club media (HANDOVER §6)
-- One public 'media' bucket holds the crest, club photo pool, opponent badges
-- and player headshots. Public READ (these aren't sensitive and the URLs sit
-- behind unguessable paths); WRITE/UPDATE/DELETE restricted to admins, reusing
-- the same is_admin() helper the table RLS uses.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

-- storage.objects already has RLS enabled by Supabase.
drop policy if exists media_public_read on storage.objects;
create policy media_public_read on storage.objects
  for select
  using (bucket_id = 'media');

drop policy if exists media_admin_insert on storage.objects;
create policy media_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and public.is_admin(auth.uid()));

drop policy if exists media_admin_update on storage.objects;
create policy media_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and public.is_admin(auth.uid()))
  with check (bucket_id = 'media' and public.is_admin(auth.uid()));

drop policy if exists media_admin_delete on storage.objects;
create policy media_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and public.is_admin(auth.uid()));
