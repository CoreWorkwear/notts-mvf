-- ============================================================================
-- Migration 0021: self-hosted client error log (observability)
-- The app posts crashes, unhandled rejections and failed reads/writes here so
-- breakage is visible without waiting for users to complain. Admins read; any
-- signed-in user can log their own row. (See src/lib/logger.js.)
-- ============================================================================

create table if not exists client_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  profile_id uuid references profiles(id) on delete set null,
  club_id uuid references clubs(id) on delete set null,
  kind text not null,                 -- render | rejection | error | fetch | write
  message text not null,
  context jsonb,
  url text,
  user_agent text
);
alter table client_errors enable row level security;

drop policy if exists client_errors_insert on client_errors;
create policy client_errors_insert on client_errors for insert to authenticated
  with check (profile_id is null or profile_id = auth.uid());

drop policy if exists client_errors_admin_read on client_errors;
create policy client_errors_admin_read on client_errors for select to authenticated
  using (is_admin(auth.uid()));

drop policy if exists client_errors_admin_delete on client_errors;
create policy client_errors_admin_delete on client_errors for delete to authenticated
  using (is_admin(auth.uid()));

grant insert on client_errors to authenticated;
grant select, delete on client_errors to authenticated;
create index if not exists client_errors_recent on client_errors (created_at desc);
