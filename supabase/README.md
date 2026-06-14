# Supabase — Notts MvF

Run order (SQL editor, top to bottom), each as its own run:

1. `migrations/0001_init_schema_and_rls.sql` — tables, helpers, triggers, RLS, grants.
2. `seed.sql` — the club, the current season (2025/26), the two teams.
3. `tests/rls_test.sql` — the security gate. Runs in a transaction that **rolls
   back**, so it changes nothing. You want to see `ALL RLS TESTS PASSED` in the
   output (Messages/Notices tab). If any test fails it raises and names the rule
   that broke — fix the policy, re-run.

The whole point of step 3: a Community-only lad must never see or respond to an
XL fixture, and nobody can promote themselves. That's proven here before a line
of frontend gets written (HANDOVER §8.2).

## The first admin (real, not test)
After you register yourself through the app (later), flip your own row to admin
once, by hand, in **Table editor → profiles** (set `role = 'admin'`). Every
admin after that is made in-app. The DB lets the table editor do this because it
runs as `postgres`; the same change attempted as a normal logged-in user is
blocked by the `protect_profile_columns` trigger.
