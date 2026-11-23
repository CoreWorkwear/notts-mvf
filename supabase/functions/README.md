# Edge Functions — Notts MvF

Five functions. Three are **admin-only** (they verify the caller's JWT is an
ACTIVE admin, mirroring `is_admin()`); `run-reminders` is fired by pg_cron and
gated by a shared secret instead. `run-training-push` uses the same private
cron gate to dispatch durable training notices. Deploy with the Supabase CLI (or the
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
    trainingPush.js bounded training outbox delivery and abortable encrypted Web Push
  admin-create-player/index.ts
  admin-delete-player/index.ts
  run-reminders/index.ts
  run-training-push/index.ts
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
All five run with **platform `verify_jwt = false`** (set in `supabase/config.toml`)
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

## Training notices and the private minute worker

Migration **0042** writes one durable in-app event and one outbox row per
already subscribed device when a manager moves or cancels a session. The
cohort is every active, signed-off account in the same club, including
supporters and players outside the invited squad, regardless of their answer.
Device opt-in is optional; no device subscription means the in-app notice alone.
Moved notices contain old/new details and invite eligible players to update
their availability. Cancelled notices contain no RSVP action. Both open
`/training?session=<id>` and carry their distinct `training-<notice-id>` tag.

`run-training-push` claims **20** rows once per request, sends at most **4**
concurrently, and acknowledges each with its lease token. Each provider fetch
has an **8-second wall-clock abort**, refuses redirects and uses the existing
subscription host allowlist; each database fetch has a **5-second abort**.
Web Push encryption/VAPID comes from the installed `web-push` library.
No request retries locally. Migration 0042 owns the **2-minute lease**,
`SKIP LOCKED` claims, exponential backoff and **5-attempt cap**. Invalid or
404/410 subscriptions end that outbox delivery immediately; transient failures
remain pending. Stale/failed acknowledgements are counted separately.
Subscriptions and provider response bodies are never logged.

Delivery is **at least once**: a provider can accept a push before the finish
RPC fails. Its stable tag replaces a duplicate tray card. `sent` means the
provider accepted the request; it is not proof the device displayed or read it.
In-app notice delivery remains independent of device delivery.

Release owner setup, in this order (no real push is required for local proof):

1. Apply **0042**; deploy `run-training-push` with its `_shared` imports and
   **`verify_jwt=false`**, using the existing VAPID and `CRON_SECRET` secrets.
   `supabase functions deploy run-training-push` reads its config entry.
   A POST without `x-cron-secret` must return the function's own 401 with
   `requestId`; authenticated non-POST requests return 405. Do not send a valid
   cron request against a live queue merely to check authentication.
2. Apply **0043**. Where `pg_cron` and `pg_net` are installed, it creates or
   updates only `training-push-minute`; it leaves `run-reminders-hourly`
   untouched. Each minute checks for due work before making an HTTP request.
   With no due work, or without Vault configuration, it makes no request.
3. Once the worker is ready, the owner adds Vault `training_push_url` with
   `https://<project-ref>.supabase.co/functions/v1/run-training-push`. It reuses
   the existing Vault `reminders_cron_secret`; neither the migration nor cron
   command contains its value. Removing `training_push_url` pauses device
   dispatch without removing in-app notices. If extensions are installed after
   migration 0043, rerun its final scheduling DO block.

The dispatch function is owner-only: no anon, authenticated or service-role
execute permission. The worker's claim/finish RPCs are service-role-only.
Local tests use fake subscriptions and an injected transport; no real push,
hosted database, deployment or secret is needed.

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


### Push payload for an admin action

The [JSON Schema](push-payload.schema.json) describes the portable encrypted payload. Recipient selection via `profileIds` belongs to the admin request.

`send-push` accepts `title`, `body`, optional `fixtureId`, `profileIds`, and `withAvailability`. The recipient checks above apply before the display payload is assembled.

- `url` or `data.url` specifies an app path. A valid top-level path takes precedence. The sender also writes the chosen path at the top level for older installations. The default is `/fixtures`.
- `teamKey` may be `xl` or `community`. For a named fixture, `kind: "lineup"` opens its Line-up tab. `withAvailability: true` gives that fixture its standard answer buttons. Training notices use their own dispatcher and always open the training session.
- `icon`, `badge`, and an action’s `icon` may point to app images with a root-relative path. Supported extensions are PNG, JPEG, WebP, GIF, SVG, ICO and AVIF. Omitted or invalid overrides use the team or club icon and the club badge.
- `tag` groups replacements and may contain up to 128 letters, digits, underscores, dots, colons or hyphens. `actions` is an array of `{ action, title, icon? }`. Each device limits visible actions. A custom action opens the body destination. For fixture actions, the standard identifiers `lineup`, `availability`, `in`, `maybe` and `out` retain their behaviour.

Preview an administrative notification body locally with Node. This prints the cleartext payload that the sender encrypts for each target device.

```bash
node --input-type=module -e "import {adminPushPayload} from './supabase/functions/_shared/push.js'; console.log(JSON.stringify(adminPushPayload({title:'Kit change',body:'Wear green.',tag:'news-kit',data:{url:'/news'},icon:'/push-community.png',badge:'/push-badge.png',actions:[{action:'open',title:'Read update'}]},null),null,2))"
```

## Note
iOS web-push only works for an installed (home-screen) PWA on iOS 16.4+ and is
unreliable; Android/desktop are solid. This is the accepted MVP limitation —
the trigger to Capacitor-wrap if reliable iPhone push becomes essential.
