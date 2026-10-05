# Supabase — Notts MvF

Run order (SQL editor, top to bottom), each as its own run:

1. `migrations/0001_init_schema_and_rls.sql` — tables, helpers, triggers, RLS, grants.
2. every later numbered migration in order, `0002_*` … `0037_*`, each as its own
   run. They are cumulative and the order matters. **Never re-run a migration
   older than the newest one already applied.** Several of them `alter policy`
   in place (0031 above all), so replaying one silently puts back policy bodies
   that 0034–0037 tightened, and 0033 then stops the replay part-way. If you
   lose track of what is applied, run step 4: it names what is missing.
3. `seed.sql` — the club, the current season (2025/26), the two teams.
4. `tests/rls_test.sql` — the security gate. Runs in a transaction that **rolls
   back**, so it changes nothing. You want to see `ALL RLS TESTS PASSED` in the
   output (Messages/Notices tab). If any test fails it raises and names the rule
   that broke — fix the policy, re-run.

`0037_security_audit_hardening.sql` is the newest; run it and then re-run step 4,
where T27–T31 check it landed. It only tightens (revokes, club scoping, CHECK
constraints on URL columns) — no new columns, so the app never needs it to be in
place before a deploy.

## Two settings that live in the Dashboard, not in SQL
The database cannot enforce these, so they are easy to lose and worth checking
after any project change:

- **Authentication → Policies**: minimum password length **10** (matching
  `MIN_PASSWORD` in `src/lib/constants.js`) and **leaked-password protection ON**.
  The checks in the app and in `admin-create-player` are UX — a self-signup can
  call GoTrue directly and skip both. This setting is the real control.
- **Project Settings → Data API → Exposed schemas**: `public, graphql_public`
  **only**. `net` must never be added: pg_net's `net.http_*` functions carry a
  default PUBLIC execute grant that cannot be revoked from the `postgres` role,
  so keeping the schema off the API is what stops them being reachable. See the
  note at the top of migration 0037.

The whole point of step 4: a Community-only player sees First Team fixtures but
cannot answer them, no club can read or write another club's data, and nobody
can promote themselves. The harness proves each of those against the real
policies (HANDOVER §8.2).

## The first admin (real, not test)
After you register yourself through the app (later), flip your own row to admin
once, by hand, in **Table editor → profiles** (set `role = 'admin'`). Every
admin after that is made in-app. The DB lets the table editor do this because it
runs as `postgres`; the same change attempted as a normal logged-in user is
blocked by the `protect_profile_columns` trigger.
