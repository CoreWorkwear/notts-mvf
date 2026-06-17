-- Two reminder types sharing one set of offsets (later split in 0016):
--   availability  → eligible squad, "set your availability"
--   match         → players who said in/maybe, the match details
-- Offsets move to day-based periods; default last nudge ~3 days out.
alter table reminder_settings rename column enabled to availability_enabled;
alter table reminder_settings add column if not exists match_enabled boolean not null default false;
alter table reminder_settings alter column offsets set default '{336,168,72}';
update reminder_settings set offsets = '{336,168,72}' where offsets = '{48,24}';

-- Track each type separately so an availability send doesn't suppress a match send.
alter table reminders_sent add column if not exists kind text not null default 'availability'
  check (kind in ('availability','match'));
alter table reminders_sent drop constraint if exists reminders_sent_pkey;
alter table reminders_sent add constraint reminders_sent_pkey primary key (fixture_id, hours_before, kind);
