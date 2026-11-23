-- ============================================================================
-- Migration 0039: half time is optional
-- Idempotent. Schema only: no row is changed.
--
-- results.ht_us / ht_them were NOT NULL DEFAULT 0, and the result form
-- prefilled both boxes with 0 and always wrote them. So every result logged
-- without a half-time score told the squad "HT 0–0" in the match centre and on
-- the Results hero: a score nobody entered, shown as fact.
--
-- Now: NULL means "not recorded". The form leaves the two columns out of the
-- row when the boxes are blank, so with the default gone the database stores
-- NULL, and the app hides the HT line when it is NULL.
--
-- RUN THIS BEFORE THE BUILD THAT SHIPS WITH IT GOES LIVE. That order is safe:
-- the old build always writes 0/0 and never NULL, so it does not notice. The
-- other order mostly works too (a blank half time on a NEW result still lands
-- as 0–0, exactly as today), but CLEARING a half time that was already saved
-- writes NULL, which the NOT NULL constraint refuses until this has run, and
-- the manager is told to "check the form" for something the form cannot fix.
-- A phone still on the old cached build shows "HT –" for a NULL row until its
-- service worker updates.
--
-- Existing rows are left alone. A stored 0–0 cannot be told apart from a real
-- nil-nil at the break, so none is rewritten; correct one by editing that
-- result and clearing the two boxes.
--
-- Undo (only while no row holds a NULL half time):
--   alter table public.results drop constraint if exists results_ht_both_or_neither;
--   alter table public.results alter column ht_us set default 0, alter column ht_us set not null,
--                              alter column ht_them set default 0, alter column ht_them set not null;
-- ============================================================================

alter table public.results
  alter column ht_us drop not null,
  alter column ht_us drop default,
  alter column ht_them drop not null,
  alter column ht_them drop default;

-- Half a half-time score is not a score. The form always writes both or neither.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'results_ht_both_or_neither' and conrelid = 'public.results'::regclass
  ) then
    alter table public.results
      add constraint results_ht_both_or_neither check ((ht_us is null) = (ht_them is null));
  end if;
end $$;
