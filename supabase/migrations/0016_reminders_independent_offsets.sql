-- Each reminder type gets its own periods (was one shared `offsets`).
alter table reminder_settings add column if not exists availability_offsets int[] not null default '{336,168,72}';
alter table reminder_settings add column if not exists match_offsets int[] not null default '{72,24}';
-- Seed the new columns from the old shared value, keeping only valid day-based
-- choices (drops stale hour-based picks like 6).
update reminder_settings set
  availability_offsets = coalesce((select array_agg(o) from unnest(offsets) o where o in (336,168,120,96,72,48,24)), '{336,168,72}'),
  match_offsets        = coalesce((select array_agg(o) from unnest(offsets) o where o in (336,168,120,96,72,48,24)), '{72,24}');
alter table reminder_settings drop column if exists offsets;
