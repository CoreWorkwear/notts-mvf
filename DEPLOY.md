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

SPA routing needs no config: with **no top-level `404.html`** in the build,
Cloudflare Pages serves `index.html` for any path that has no file, so deep
links work. Do not add `public/404.html` — that switches the fallback off and
every deep link becomes a 404 (it did, 24 Sep to 7 Oct 2026). A `_redirects`
rule of `/* /index.html 200` does not help either: Pages rejects it as a loop.
The not-found page for missing hashed assets lives at `public/assets/404.html`.
`src/hosting.test.js` guards all of this, and `scripts/check-live.mjs` checks
the deployed site after every push to `master`.

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
- Migrations: the run order and what is applied are in `supabase/README.md` (0001–0037 are on the live DB).
- Rotate the VAPID/PAT keys that were shared during development if desired.
