-- ============================================================================
-- Migration 0007: club news / announcements
-- Admin-posted club news; everyone in the club reads it. Posting can optionally
-- fire a push (send-push broadcast). A new table, so it needs its own grants.
-- ============================================================================

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  title text not null,
  body text not null,
  created_by uuid references profiles(id),
  pushed boolean not null default false,
  created_at timestamptz not null default now()
);

alter table announcements enable row level security;

drop policy if exists announcements_select on announcements;
create policy announcements_select on announcements
  for select to authenticated
  using (club_id = current_club_id());

drop policy if exists announcements_admin_write on announcements;
create policy announcements_admin_write on announcements
  for all to authenticated
  using (club_id = current_club_id() and is_admin(auth.uid()))
  with check (club_id = current_club_id() and is_admin(auth.uid()));

grant select, insert, update, delete on announcements to authenticated;
grant all on announcements to service_role;

create index if not exists announcements_club_created_idx on announcements (club_id, created_at desc);
