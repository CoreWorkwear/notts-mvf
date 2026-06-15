# Edge Functions — Notts MvF

Two functions, both **admin-only** (they verify the caller's JWT is an admin).
Deploy with the Supabase CLI (or the dashboard's Functions UI). The MVP app
works without them (push UI hides, add-player falls back to a browser signup),
but deploy these for the real thing.

## One-time setup
```bash
supabase login
supabase link --project-ref vgeosccpwsdosbcnpcve
```

## Secrets (send-push only)
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically. Set the VAPID secrets (the PRIVATE key is the one generated
alongside the `VITE_VAPID_PUBLIC_KEY` in `.env` — keep it off the client):
```bash
supabase secrets set \
  VAPID_PUBLIC_KEY="<same public key as VITE_VAPID_PUBLIC_KEY>" \
  VAPID_PRIVATE_KEY="<the private key>" \
  VAPID_SUBJECT="mailto:you@yourclub.example"
```

## Deploy
```bash
supabase functions deploy send-push
supabase functions deploy admin-create-player
```
Both run with **platform `verify_jwt = false`** (set in `supabase/config.toml`)
so the browser CORS preflight reaches the function — they enforce admin auth
*inside* (verify the caller's JWT → `is_admin`), so this is not a hole. If you
deploy before that config is picked up, pass `--no-verify-jwt` explicitly.

## What they do
- **admin-create-player** — `auth.admin.createUser` (email-confirmed) with the
  signup metadata; the `handle_new_user` trigger builds the profile/memberships
  (forced player / not-eligible). Replaces the browser throwaway-signup stopgap.
  The Players "Add" form calls this and **falls back** to the old path if the
  function isn't deployed yet.
- **send-push** — sends Web Push to `{profileIds}` / a `{fixtureId}`'s eligible
  roster / all active players; prunes dead subscriptions (404/410). Call it from
  an admin action (e.g. "remind unanswered") via `supabase.functions.invoke('send-push', { body })`.

## Note
iOS web-push only works for an installed (home-screen) PWA on iOS 16.4+ and is
unreliable; Android/desktop are solid. This is the accepted MVP limitation —
the trigger to Capacitor-wrap if reliable iPhone push becomes essential.
