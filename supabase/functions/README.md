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
    log.js          JSON-line logger with a per-request id (mkLog), PII scrubbing, generic 500 body
    auth.js         requireActiveAdmin (shared admin gate), constant-time secret compare
    players.js      create/delete-player decisions (admin target refusal, login ban, club check)
    validate.js     body validation (uuids, profileIds, team keys)
    push.js         Web Push bookkeeping: prune 404/410 + corrupt tokens (non-https / non-push-host endpoints, missing keys), count failures by class
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

**Only the CLI reads `config.toml`.** A deploy from the dashboard's Functions UI
or through the Supabase MCP `deploy_edge_function` tool defaults platform JWT
verification to ON. With it on, the browser's CORS preflight (which carries no
token) is rejected, so adding a player, deleting a player and every push fail
for every manager, and the token-less hourly cron call is refused at the gateway
with nothing in the function's own log. On any non-CLI deploy:

1. set verify JWT **off** explicitly (`verify_jwt: false`);
2. upload the function's `index.ts` **and** every `_shared/*.js` file it imports
   (a missing one is a boot error);
3. check it afterwards, for each function:
   - `OPTIONS` with no token → `200`;
   - `POST` with no credentials → the function's **own** refusal: JSON carrying
     a `requestId`. A body of `{"code":401,"message":"Missing authorization
     header"}` instead is the gateway talking: verification is still on.

`admin-delete-player` needs **migration 0035** applied first (it calls the
`anonymise_and_delete_profile` RPC).

## The run-reminders cron
`run-reminders` has no user: pg_cron calls it every hour and it checks the
`x-cron-secret` header against the `CRON_SECRET` function secret (compared in
constant time). Keep that value in **Supabase Vault** and let the job read it
at run time, so it never appears in the job's SQL, `cron.job`, or the run logs.

```sql
-- once: store the secret (same value as `supabase secrets set CRON_SECRET=...`)
select vault.create_secret('<the cron secret>', 'reminders_cron_secret');

-- hourly job: pg_cron + pg_net, secret read from vault.decrypted_secrets
select cron.schedule(
  'run-reminders-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url     := 'https://<project-ref>.supabase.co/functions/v1/run-reminders',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_cron_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);
```
**Never paste the secret into the job command** (or any migration): pg_cron
stores the command text in plain view in `cron.job`. Rotate by updating both the
Vault entry and `CRON_SECRET`.

Migration 0008 mentions a `run-reminders/README.md`; that file doesn't exist,
this section is what it means.

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
