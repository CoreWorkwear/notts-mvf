# Supabase — Notts MvF

Run order (SQL editor, top to bottom), each as its own run:

1. `migrations/0001_init_schema_and_rls.sql` — tables, helpers, triggers, RLS, grants.
2. every later numbered migration in order, `0002_*` … `0052_*`, each as its own
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

`0039_signoff_gates_reads.sql` tightens access to club data. After applying it,
re-run step 4, where T32–T45 check it landed. It makes manager sign-off gate
every club read, supporters included (a pending or removed account sees only
its own profile), and closes the rest of the November 2026 review: push
endpoints, uploads, the error log, cross-club manager writes, anon privileges.
Ship it **with** the frontend and Edge Functions from the same commit: the
app's holding screen is what a pending account sees once it lands, and
`admin-delete-player` maps its new refusal. Read its header first. It
grandfathers every active supporter that exists when it runs (signs them off
before the gate goes on, and prints how many), so nobody already following the
club is locked out; supporters who sign up afterwards need a manager's
sign-off. Pending players are not touched. Image URLs are pinned to the live
and staging project refs in `media_url_ok()`; a new project adds its ref there.

Before 0039 the harness could never pass: T26 tripped on a NULL-context bug in
the error-log policy, so T27–T31 had never actually run (T29's sponsor check
was also vacuous). Both are fixed; a clean run now goes all the way through.

`0037_security_audit_hardening.sql` only tightens (revokes, club scoping, CHECK
constraints on URL columns) — no new columns.

`0038_relink_league_fixtures.sql` is data only: it repairs four live fixtures by
id and does nothing on any other database. A data fix on live goes in as a
numbered file like this one, with the before-image and the undo in its header,
rather than as an ad-hoc statement nobody can find afterwards.

`0040_half_time_optional.sql` makes `results.ht_us` / `ht_them` nullable (NULL =
half time not recorded) and adds a both-or-neither CHECK. It changes no rows.
**Run it before the build that ships with it goes live** (safe: the old build
never writes NULL). The other order works for a new result but refuses a save
that *clears* a half time already stored. T46 in step 4 checks it landed.

Migrations 0041 and 0042 add Training sessions, replies, club notices and push delivery records. Run `tests/training_test.sql` against an isolated test database after the migrations. Its synthetic accounts and activity roll back. Migration 0043 configures dispatch scheduling. See [the release and rollback procedure](../Docs/mobile-ux/TRAINING-RELEASE.md) and [Edge Function setup](functions/README.md) before enabling push.

## Player accounts release switch

Apply migrations 0045–0052 in order on the target database before running the
matching app build. The rollback tests in `supabase/tests/` cover the ledger,
effective-dated fees, activity finance report, manager corrections, opening
balances, match appearances and training attendance.

Each club starts with player accounts off. The owner enables the feature and
records the cutover in one transaction with
`set_club_payments_release(club_id, true, true)`. Once cutover is recorded,
the former per-fixture paid ticks remain in the archive. The fixture toggle is
retired even while accounts are paused.

Use `set_club_payments_release(club_id, false)` to pause and
`set_club_payments_release(club_id, true)` to resume a club that already cut
over. The function is restricted to privileged server or database operator
roles. Pausing hides the account surfaces and refuses new manager postings.
Posted entries stay intact. The ledger accepts trusted Stripe settlement and
refund entries for previously initiated payments. The Stripe integration must
verify and match provider events before using that path.

Reconcile the signed opening credit and arrears totals in Club admin, under
Club settings and Opening balances. The first successful manager entry
sets the effective date for the club. Enter each opening before any other
activity on that account. Historic fixture paid ticks stay in the archive.


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

The whole point of step 4: nobody reads club data until a manager signs them
off, a Community-only player sees First Team fixtures but cannot answer them,
no club can read or write another club's data, and nobody can promote
themselves. The harness proves each of those against the real
policies (HANDOVER §8.2).

## The first admin (real, not test)
After you register yourself through the app (later), flip your own row to admin
once, by hand, in **Table editor → profiles** (set `role = 'admin'`). Every
admin after that is made in-app. The DB lets the table editor do this because it
runs as `postgres`; the same change attempted as a normal logged-in user is
blocked by the `protect_profile_columns` trigger.
