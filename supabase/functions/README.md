# Edge Functions — Notts MvF

Four functions. Three are **admin-only** (they verify the caller's JWT is an
ACTIVE admin, mirroring `is_admin()`); `run-reminders` is fired by pg_cron and
gated by a shared secret instead. Deploy with the Supabase CLI (or the
dashboard's Functions UI). The MVP app works without them (push UI hides,
add-player falls back to a browser signup), but deploy these for the real thing.

## Layout
```
functions/
  _shared/          plain-JS ESM — the decision logic, unit-tested with vitest
    log.js          JSON-line logger with a per-request id (mkLog)
    validate.js     body validation (uuids, profileIds, team keys)
    push.js         Web Push bookkeeping: prune 404/410 + corrupt tokens, count failures by class
    roster.js       who counts as "the squad" (approved, active players)
    reminders.js    run-reminders' per-fixture flow (ledger-as-lock, read errors → skip)
  admin-create-player/index.ts
  admin-delete-player/index.ts
  run-reminders/index.ts
  send-push/index.ts
```
Each `index.ts` only wires Supabase into `_shared/` (Deno imports the `.js`
files relatively, e.g. `import { mkLog } from '../_shared/log.js'`). Put any
new decision logic in `_shared/` with a test — the standard is **no fix without
a test that fails on the old code**, and Deno isn't on the dev box.

### Running the `_shared` tests
```powershell
$env:Path = "C:\Program Files\nodejs;" + $env:Path
npx vitest run supabase/functions/_shared --reporter=dot
```
(`npm test` runs them too — `vite.config.js` includes that path.)

## One-time setup
```bash
supabase login
supabase link --project-ref vgeosccpwsdosbcnpcve
```

## Secrets
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically. Set the VAPID secrets for `send-push` + `run-reminders` (the
PRIVATE key is the one generated alongside the `VITE_VAPID_PUBLIC_KEY` in
`.env` — keep it off the client), and the cron secret for `run-reminders`:
```bash
supabase secrets set \
  VAPID_PUBLIC_KEY="<same public key as VITE_VAPID_PUBLIC_KEY>" \
  VAPID_PRIVATE_KEY="<the private key>" \
  VAPID_SUBJECT="mailto:you@yourclub.example" \
  CRON_SECRET="<same value the pg_cron job sends as x-cron-secret>"
```

## Deploy
```bash
supabase functions deploy send-push
supabase functions deploy admin-create-player
supabase functions deploy admin-delete-player
supabase functions deploy run-reminders
```
All four run with **platform `verify_jwt = false`** (set in `supabase/config.toml`)
so the browser CORS preflight reaches the function — the admin ones enforce
auth *inside* (verify the caller's JWT → `is_admin`), and `run-reminders`
checks `x-cron-secret`, so this is not a hole. If you deploy before that
config is picked up, pass `--no-verify-jwt` explicitly.

`admin-delete-player` needs **migration 0035** applied first (it calls the
`anonymise_and_delete_profile` RPC).

## Logging and the request id
Every request logs ONE JSON `done` line — who called (profile id), mode,
targets, tokens, sent, pruned (404/410 + corrupt), failed by status class
(`4xx` / `5xx` / `other`), elapsed ms — plus a `warn`/`error` line for anything
skipped. Tokens and PII are never logged. The request id comes back in the
**`x-request-id`** response header (and as `requestId` in the JSON body), so a
"Push unavailable" toast can be matched to its log line in the dashboard.

## What they do
- **admin-create-player** — `auth.admin.createUser` (email-confirmed) with the
  signup metadata; the `handle_new_user` trigger builds the profile (forced
  player / pending / reserves). The function then signs the account off and
  sets the squads to exactly what the manager ticked. Every step after
  `createUser` is checked: the login exists either way, so a failure past that
  point returns 200 + `warning` naming what didn't stick (approval, squads)
  rather than a "clean save". Replaces the browser throwaway-signup stopgap;
  the Players "Add" form **falls back** to the old path if it isn't deployed.
- **admin-delete-player** — permanent delete. One RPC
  (`anonymise_and_delete_profile`, service-role only, club-checked) snapshots
  the player's name onto goals / MOTM / line-ups, nulls the links, drops subs
  records and deletes the profile **atomically**; then the auth login goes.
- **send-push** — sends Web Push to `{profileIds}` (validated: a non-empty
  array of uuids, 400 otherwise; then filtered to approved, active players in
  the caller's club) / a `{fixtureId}`'s squad / every active, approved account
  in the club. Prunes dead (404/410) and corrupt subscriptions. Call it from an
  admin action via `supabase.functions.invoke('send-push', { body })`.
- **run-reminders** — hourly. Per fixture: the `reminders_sent` INSERT is the
  lock (a PK conflict means another run owns that offset → skip); any read
  error skips the fixture (never "send to everyone"); a claim that delivered to
  nobody is released so the next run retries. Rescheduling a fixture re-arms
  its ledger (migration 0035 trigger).

## Note
iOS web-push only works for an installed (home-screen) PWA on iOS 16.4+ and is
unreliable; Android/desktop are solid. This is the accepted MVP limitation —
the trigger to Capacitor-wrap if reliable iPhone push becomes essential.
