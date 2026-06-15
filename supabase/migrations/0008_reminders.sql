-- ============================================================================
-- Migration 0008: auto availability reminders
-- reminder_settings: per-club config (on/off + which hours-before offsets).
-- reminders_sent: ledger so each (fixture, offset) reminder fires exactly once
--   — service-role only (written by the run-reminders Edge Function).
-- The hourly pg_cron job + extensions are set up separately (see
-- supabase/functions/run-reminders/README.md).
-- ============================================================================

create table if not exists reminder_settings (
  club_id uuid primary key references clubs(id) on delete cascade,
  enabled boolean not null default false,
  offsets int[] not null default '{48,24}',  -- hours before kickoff
  updated_at timestamptz not null default now()
);
alter table reminder_settings enable row level security;
drop policy if exists reminder_settings_select on reminder_settings;
create policy reminder_settings_select on reminder_settings
  for select to authenticated using (club_id = current_club_id());
drop policy if exists reminder_settings_admin_write on reminder_settings;
create policy reminder_settings_admin_write on reminder_settings
  for all to authenticated
  using (club_id = current_club_id() and is_admin(auth.uid()))
  with check (club_id = current_club_id() and is_admin(auth.uid()));
grant select, insert, update, delete on reminder_settings to authenticated;
grant all on reminder_settings to service_role;

create table if not exists reminders_sent (
  fixture_id uuid not null references fixtures(id) on delete cascade,
  hours_before int not null,
  sent_at timestamptz not null default now(),
  primary key (fixture_id, hours_before)
);
alter table reminders_sent enable row level security; -- no policies = service-role only
grant all on reminders_sent to service_role;

insert into reminder_settings (club_id, enabled, offsets)
select id, false, '{48,24}' from clubs
on conflict (club_id) do nothing;
