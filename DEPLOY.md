# Deploy — Notts MvF (Cloudflare Pages)

Static SPA + Supabase. The anon key ships in the client; RLS is the security.

## 0. Edge Functions first (push + admin add-player)
See `supabase/functions/README.md`. Deploy `send-push` + `admin-create-player`
and set the VAPID secrets before launch. The app degrades gracefully without
them (push UI no-ops; add-player uses a browser fallback).

## 1. Push to GitHub
```bash
git remote add origin https://github.com/<you>/notts-mvf.git
git push -u origin master   # (or main)
```
`.env` and `.mcp.json` are gitignored — secrets stay out of the repo.

## 2. Cloudflare Pages
Dashboard → Workers & Pages → Create → Pages → Connect to Git → pick the repo.
Build settings:
- **Framework preset:** Vite (or None)
- **Build command:** `npm run build`
- **Build output directory:** `dist`

Environment variables (Settings → Environment variables, Production + Preview):
- `VITE_SUPABASE_URL` = https://vgeosccpwsdosbcnpcve.supabase.co
- `VITE_SUPABASE_ANON_KEY` = (the anon key from `.env`)
- `VITE_VAPID_PUBLIC_KEY` = (the VAPID public key from `.env`)

SPA routing is handled by `public/_redirects` (`/* /index.html 200`), so deep
links and PWA navigation work.

## 3. Supabase Auth URLs
Dashboard → Authentication → URL Configuration:
- **Site URL:** your Pages URL (e.g. https://notts-mvf.pages.dev)
- **Redirect URLs:** add the Pages URL (so login + password-reset links land on prod).

## 4. Smoke test on the deployed URL
- Sign in; land on Fixtures.
- Install to home screen (PWA), reopen standalone.
- Admin: add a fixture, log a result, manage a player/opponent/season.
- Notifications: turn on, then "Send push reminder" from Who's In (needs the
  function deployed) → a notification arrives (Android solid; iPhone best-effort,
  installed PWA only).

## Notes
- First admin is bootstrapped by hand once (Table editor → profiles.role='admin').
- Migrations 0001–0005 must be run on the project (they are, on the live DB).
- Rotate the VAPID/PAT keys that were shared during development if desired.
