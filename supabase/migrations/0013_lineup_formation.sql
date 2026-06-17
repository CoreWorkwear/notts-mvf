-- Remember the chosen formation so the pitch redraws exactly. Denormalised onto
-- each line-up row (same value across a fixture's rows) — read from any row.
alter table lineups add column if not exists formation text;
