# Nottinghamshire MvF — Team Hub: Build Handover (v2, current)

**For:** Claude Code
**Replaces:** the original HANDOVER.md (now out of date — ignore it).
**Companion files:** `notts-mvf.html` (the complete working prototype — UI/UX + behaviour reference), `DESIGN-SYSTEM.md` (colour/type/shape tokens + signature elements — leads on visuals), `UX-AND-IA.md` (information architecture + key flows, reasoned per persona — leads on interaction/layout), `DESIGN-RESEARCH.md` (the why behind the design choices), `BUILD-LIST.md` (forward features), `PERSONAS-AND-STORIES.md` (who it's for + "done when…" acceptance criteria), and `GLOSSARY.md` (domain terms + the British-football language rules). This doc supersedes and absorbs the build list where they overlap; the others stand alongside it. **On any conflict: UX-AND-IA leads on layout/flow, DESIGN-SYSTEM leads on look, this doc leads on data/security/scope, and the prototype is the behaviour reference (but its fonts/palette are first-draft — take those from DESIGN-SYSTEM).**

**Goal:** Build the real, multi-user, deployable team-management app for Nottinghamshire MvF. The prototype is a complete, clickable spec of the intended product. Build the real thing on Supabase + Cloudflare to match it. Treat the prototype as the source of truth for layout, flows, copy, and visual design. Ignore only its fakery: in-memory state, fake auth, and the placeholder SVG crest.

---

## 1. Stack (locked)

- **Frontend:** React + Vite (the prototype is one file; break it into components — see §7).
- **Backend:** Supabase — Postgres, Auth (email+password), Row-Level Security, real-time, Storage (for images).
- **Hosting:** Cloudflare Pages. Static SPA talking to Supabase via `@supabase/supabase-js` with the anon key. Safe to ship the anon key **because RLS enforces every rule at the DB** (§4).
- **Platform:** Ship as a **PWA** (installable, full-screen, both iOS/Android). Architect clean so a later **Capacitor** wrap to the App Store / Play Store is an option, not a rewrite.
- **Push notifications:** post-MVP. iOS PWA push is unreliable; if reliable push becomes day-one critical, that's the trigger to Capacitor-wrap. WhatsApp covers nudges until then.
- **Cost target:** £0–5/month (Supabase + Cloudflare free tiers cover club scale).

---

## 2. Core domain model (as built in the prototype)

**One club, two teams.** XL 11s (the first team, **red** `#C8102E` / bright `#FF2E43`) and Community (the reserves, **green** `#1B6B2E` / bright `#3FB950`). Red leads as the primary brand colour. Players belong to one or both teams (a list, not a single field). Think of it the FM way: first team + reserves, shared squad, stats that roll up to the club but split by team.

**Two roles.** Player (default on registration) and Admin. Admins do everything players do plus manage fixtures, results, players, the league table, and media. Admins are created only by other admins. Nobody can demote or deactivate themselves (prevents lockout).

**XL eligibility gate.** A boolean per player. Only XL-eligible players can see, and set availability for, XL fixtures. Community is open to anyone in the Community team. New registrations are always player / not XL eligible — both are granted by an admin, never self-claimed.

**Seasons.** Everything (fixtures, results, stats, tables) belongs to a season (e.g. "2025/26"). A season picker in the header scopes the whole app. New fixtures default to the current season.

**Match fee:** £7 per player per game (not yet surfaced in UI — payments are a parked feature, but bank the figure).

---

## 3. Database schema (Postgres / Supabase)

Multi-tenant-ready: a `clubs` table as root, every owned row carries `club_id`, so white-labelling later isn't a retrofit. Seed one club: Nottinghamshire MvF.

```
clubs
  id uuid pk default gen_random_uuid()
  name text not null
  crest_url text                          -- the real club badge (Storage URL)
  created_at timestamptz default now()

seasons
  id uuid pk default gen_random_uuid()
  club_id uuid references clubs(id) not null
  label text not null                     -- "2025/26"
  is_current boolean default false

teams                                     -- fixed two for now, but a table so it's extensible
  id uuid pk default gen_random_uuid()
  club_id uuid references clubs(id) not null
  key text not null                       -- 'xl' | 'community'
  label text not null                     -- 'XL 11s' | 'Community'
  is_first_team boolean default false
  colour text                             -- brand hex
  league_name text                        -- default league for this team's league fixtures

profiles                                  -- 1:1 with auth.users
  id uuid pk references auth.users(id) on delete cascade
  club_id uuid references clubs(id) not null
  first_name text not null                -- REQUIRED
  last_name text not null                 -- REQUIRED
  email text not null                     -- REQUIRED (also the auth login)
  phone text not null                     -- REQUIRED
  dob date
  ec_name text                            -- emergency contact
  ec_phone text
  positions text[] not null default '{}'
  preferred text
  role text not null default 'player'     -- 'player' | 'admin'
  xl_eligible boolean not null default false
  active boolean not null default true    -- soft delete; inactive kept for history
  photo_url text                          -- player headshot (Storage)
  created_at timestamptz default now()

team_memberships
  id uuid pk default gen_random_uuid()
  profile_id uuid references profiles(id) on delete cascade not null
  team_id uuid references teams(id) not null
  unique (profile_id, team_id)

opponents                                 -- so a badge attaches to the opponent, not each fixture
  id uuid pk default gen_random_uuid()
  club_id uuid references clubs(id) not null
  name text not null
  badge_url text                          -- Storage URL; null = monogram fallback

fixtures
  id uuid pk default gen_random_uuid()
  club_id uuid references clubs(id) not null
  season_id uuid references seasons(id) not null
  team_id uuid references teams(id) not null
  opponent_id uuid references opponents(id) not null
  match_date date not null
  kickoff time not null
  home_away text not null default 'Home'  -- 'Home' | 'Away'
  fixture_type text not null default 'League' -- 'League'|'Friendly'|'Cup'|'Other'
  league_name text                        -- only for League type; defaults from team
  venue text not null
  address text
  w3w text                                -- what3words "///a.b.c"
  pinned_image_id uuid references media_assets(id)  -- null = random club photo
  created_at timestamptz default now()

availability
  id uuid pk default gen_random_uuid()
  fixture_id uuid references fixtures(id) on delete cascade not null
  profile_id uuid references profiles(id) on delete cascade not null
  status text not null                    -- 'in' | 'maybe' | 'out'
  updated_at timestamptz default now()
  unique (fixture_id, profile_id)

results                                   -- one per played fixture
  fixture_id uuid pk references fixtures(id) on delete cascade
  ht_us int default 0
  ht_them int default 0
  us int default 0
  them int default 0
  motm_profile_id uuid references profiles(id)   -- nullable
  motm_name text                          -- free-typed fallback if not a squad member

goals                                     -- our team's goals only; opposition is just the number
  id uuid pk default gen_random_uuid()
  fixture_id uuid references fixtures(id) on delete cascade not null
  scorer_profile_id uuid references profiles(id)  -- nullable…
  scorer_name text                        -- …with free-typed fallback (guests/trialists/OGs)
  assist_profile_id uuid references profiles(id)
  assist_name text
  minute int                              -- optional

league_tables                             -- fully MANUAL; admin keeps it current from the league's own source
  id uuid pk default gen_random_uuid()
  club_id uuid references clubs(id) not null
  season_id uuid references seasons(id) not null
  team_id uuid references teams(id) not null   -- which of our teams' division this is
  team_name text not null                 -- a row in the standings (incl. our own)
  played int default 0
  won int default 0
  drawn int default 0
  lost int default 0
  gf int default 0
  ga int default 0
  pts int default 0
  -- GD computed (gf-ga); sort by pts, then GD, then GF

media_assets
  id uuid pk default gen_random_uuid()
  club_id uuid references clubs(id) not null
  type text not null                      -- 'photo' (poster bg) | 'crest' | 'player_photo' | 'opponent_badge'
  url text not null                       -- Supabase Storage
  uploaded_by uuid references profiles(id)
  created_at timestamptz default now()
```

Positions are a frontend constant, not a table: `GK, RB, CB, LB, CDM, CM, CAM, RM, LM, RW, LW, ST, CF`.

### Profile creation trigger
On new `auth.users` signup, a Postgres trigger (`handle_new_user`) creates the `profiles` row + `team_memberships` from signup metadata (first/last/email/phone REQUIRED, positions, preferred, teams). **Always force `role='player'` and `xl_eligible=false` server-side** regardless of what the client sends.

### Data-integrity notes (learned in the prototype)
- **Stats key by profile_id, not name.** The prototype tallies goals/assists/MOTM by matching the typed *name* string. That's fine for a mock but in production a typo splits one player into two on the stats table. Scorer/assister/MOTM should resolve to `profile_id` when the name matches a squad member, and only fall back to the free-typed string for genuine non-squad names.
- **"Appearances" currently inferred from availability='in'.** That's a proxy. Ideally add a real "played"/selected-XI concept distinct from availability, so a scorer who wasn't marked available still gets the appearance. Minimum: keep the availability proxy but note it; better: a `lineups` table or a `played` flag on availability.
- **Required fields enforced at the DB** (first/last/email/phone NOT NULL), not just the form — the CSV import path (§6) must respect them too.

---

## 4. Row-Level Security (the real enforcement)

Enable RLS on every table. The UI mirrors these rules; RLS *is* the security. Helper: `is_admin(uid)` returning boolean (`security definer` to avoid recursion).

- **profiles** — SELECT: any authed user in the club (needed for squad lists / who's-in / stats). UPDATE self: only own row, and a `BEFORE UPDATE` trigger blocks non-admins changing `role`, `xl_eligible`, `active`, `club_id` (reset to old values). UPDATE admin: any profile in club, all columns. INSERT via trigger only. DELETE: none (use `active=false`).
- **team_memberships** — SELECT authed; write admin only.
- **fixtures** — SELECT: a player may select a fixture only if they have a matching team_membership AND (team isn't XL OR `xl_eligible`). Admins all. Write: admin only.
- **availability** — SELECT authed in club. INSERT/UPDATE: only own row (`profile_id = auth.uid()`) AND only for a fixture they're allowed to see (same team+eligibility test). DELETE: own or admin.
- **results, goals** — SELECT authed in club. Write: admin only.
- **league_tables** — SELECT authed; write admin only.
- **opponents, media_assets** — SELECT authed; write admin only.

The "only admins create admins" and "only admins set xl_eligible/active" rules live in the profiles UPDATE policy/trigger, **not** the React.

---

## 5. Screens & behaviour (match the prototype)

Bottom tab nav, mobile-first. Hardware back closes open sheets (the prototype pushes a history entry per sheet — replicate). Season picker in the header scopes everything.

**Tabs — player:** Fixtures · Results · Club · You (profile).
**Tabs — admin:** Fixtures · Results · Club · Who's In · Players · You.

**Auth** — login + register tabs. Register captures first/last/phone/email/password (all REQUIRED), positions (multi-select), preferred position, team(s). Lands as player / not eligible.

**Fixtures (the landing + primary action surface — see UX-AND-IA.md)** — everyone lands here; it's not a passive list. List (default) and Calendar toggle, plus a team filter that only appears for admins or players in both squads. The **next-game poster hero** tops it and is an *action surface*: for a **player** it carries the **in / maybe / out** control inline (one tap, saved-confirmation inline, no drill-in; if unanswered it's the visual focus); for the **gaffer** it leads with **squad state** ("9 in · 3 maybe · 4 not replied") tappable to who's-in / chase. Below: a personal status line (player: "you're in for 2 of 3"; admin: a subtle "needs doing" strip — results to log, low-numbers games, subs outstanding), then **strip rows** reading as a clear matchup (our team v opponent, home team first, kickoff/home-away/type/venue tags), each showing the viewer's own availability at a glance and settable inline. Calendar = month grid with team-coloured tappable dots + a "this month" agenda list. Tap a fixture → detail sheet (venue, directions, weather, full who's-in) — only needed for the fuller picture, never for the common one-tap job. Availability is also settable from push notifications (inline In/Maybe/Out actions — MVP infra, Android solid, iPhone best-effort).

**Fixture detail sheet** — coloured poster header (team gradient + concentric motif + crest v opponent), venue block (full address, Open in Maps, what3words link), then two tabs: **My availability** (first; in/maybe/out with a "saved" confirmation) and **Who's in** (full squad split into available/maybe/out/no-reply, your own row tagged "YOU", a "you're down as" status line). Admins get Edit fixture. Tapping the counts on a card jumps straight to Who's in.

**Fixture form (admin)** — team, date, opponent, venue, address, what3words, home/away, kickoff, type, season, and league name (shown only when type=League, auto-filled from the team, overridable).

**Results** — own tab. Most recent result as a poster hero, earlier ones as strips with a W/D/L flash. Admin sees a "needs a result" list for past fixtures without one. Tap → **match centre** (FM-style): big FT score + HT under it, MOTM with a star, a goal timeline (minute, scorer, assister, connected down the page), and the squad that played with goals/assists tallied per name. Admin: Add/Edit result — FT + HT scores, add goals one at a time (scorer + optional minute + optional assist, squad-pick-or-free-type via a datalist), MOTM (pick or type).

**Club tab** — sub-toggle between **League Table** and **Club Stats**.
- *League Table*: per team, per season, **fully manual**. Admin "Edit table" opens an editable grid (team, P/W/D/L/GF/GA/Pts), auto-sorts by pts→GD→GF, our row highlighted. View mode: pos, team, P, GD, Pts, W-D-L.
- *Club Stats* (FM-style): a **Whole Club / XL 11s / Community** toggle. A **Golden Boot** panel (crown; club-wide on Whole Club, per-team when filtered; handles ties). Leaderboards: top scorers, assists, appearances, MOTM. Full sortable squad table — every figure shows the combined total with a **league/friendly split underneath** (e.g. "3" over "2L · 1F"). All derived from results; nothing manually entered here.

**You / Profile** — self-edit name/phone/positions/preferred (email is the login, admin-changed). Shows team badges, XL-eligible badge, admin badge.

**Players (admin)** — full squad records. Search, add manually (with starter password to hand over), edit any field (name, phone, DOB, email, emergency contact, positions, preferred, teams, XL flag, role), reset password (a reset action — passwords are never viewable, hashed), and active/inactive toggle (inactive drops off squad/availability but stays on past results). Active and inactive shown in separate sections. Required-field validation + duplicate-email guard.

---

## 6. Media & branding system

Use the club's real assets so it feels like the club (the IG NEXT-UP / FULL-TIME look is the target).
- **Real club crest** (currently a placeholder SVG in the prototype) — uploaded asset, used in header, login, poster heroes, everywhere the prototype draws a crest. Swappable.
- **Club photo pool** — admins upload club photos; used as poster backgrounds behind fixture/result heroes and detail headers. **Random by default**, with an admin option to **pin** a specific photo to a fixture. Dark gradient wash stays over them so white display type reads.
- **Opponent badges** — set once per opponent (the `opponents` table), reused across all fixtures vs that team. Replaces the dashed-monogram placeholder.
- **Per-player photos** — headshot on profile/squad/match-centre.
- **Permissions:** admins manage all media (no separate media role for now). NOTE: a media-only role is the clean later option if image duties go to someone who shouldn't touch squad data — same permissions layer, addable without rework.
- All images in **Supabase Storage**; compress/resize on upload for mobile.

---

## 7. Frontend structure (suggested)

```
src/
  lib/supabase.js                // client from env vars
  lib/constants.js               // POSITIONS, team colours, MATCH_FEE
  lib/stats.js                   // buildStats() — port from prototype, key by profile_id
  context/AuthContext.jsx        // session, current profile, role/eligibility helpers
  context/SeasonContext.jsx      // selected season
  hooks/useSheetBack.js          // hardware-back closes sheets (in prototype)
  components/ Crest, Badge, AvailControl, HeroPoster, FixtureStrip, GoldenBoot, StatLeader, Sheet…
  pages/ Auth, Fixtures, FixtureDetail, Results, MatchCentre, Club(LeagueTable+Stats), Players, Profile, AdminAvailability
  App.jsx                        // routing + role-gated bottom nav + season picker
```
Design tokens, palette, fonts (Anton display / DM Sans body / DM Mono data), the concentric motif, sheet/bottom-nav patterns: see **DESIGN-SYSTEM.md** for the extracted tokens, and lift the `:root` variables + utility classes straight from the prototype's CSS. Real-time via Supabase subscriptions on fixtures/availability/results (or refetch-on-focus as a first cut).

---

## 8. Build order

1. Supabase project; `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`), gitignored.
2. Schema + RLS migration (§3, §4). Seed club, season, two teams. **Test RLS with two test users before any frontend** — confirm a non-eligible player cannot select an XL fixture.
3. Vite + React scaffold; Supabase client, Auth + Season contexts, routing, bottom nav.
4. Auth (register writes trigger metadata; confirm new user = player/not-eligible).
5. Fixtures (player view + eligibility filter first, then admin CRUD with the opponents table).
6. Fixture detail + availability (tabs, save, who's-in).
7. Results + match centre + admin result entry.
8. Club: league table (manual grid) + stats engine (port `buildStats`, key by profile_id).
9. Players admin (full record, add/edit, reset, active/inactive).
10. Payments (admin paid toggle per player per fixture — §10) + per-fixture CSV export (§10).
11. Media system (Storage, crest, photo pool, opponent badges, player photos).
12. Weather on fixture cards (geocode venues, scheduled forecast fetch, card strip — §10/§12).
13. PWA (manifest, crest icons, service worker, install prompt).
14. Push notifications (token storage, send Edge Function; Android solid, iPhone best-effort — §10).
15. Deploy to Cloudflare Pages (env vars in build settings; `npm run build` → `dist`).
16. **First admin:** register yourself, then flip your `role` to admin once by hand in the Supabase table editor. Every admin after that is made in-app.

---

## 9. Decisions locked (don't re-litigate)

- Both teams from day one; XL=red=first team, Community=green=reserves; membership is a list.
- New registrations always player / not eligible; eligibility + admin granted by admins only.
- XL eligibility gates XL fixture visibility AND availability writes (enforced in RLS).
- First/last/email/phone are **required** to create any profile (form + DB).
- Remove player = `active=false` (soft delete), never hard delete — preserves results history.
- Passwords are reset, never viewed.
- League table is fully manual per team/season.
- Stats split two ways: team (Club/XL/Community) and league/friendly; combined headline with split beneath.
- PWA first on Cloudflare; Capacitor later if push becomes essential.
- **British football vernacular throughout — never Americanised** (fixtures/results/pitch/kit/the lads/gaffer/nil; never soccer/field/schedule/roster). Applies to all new microcopy, empty states, and notifications.
- Dark theme, crest colours carry team identity, photographic poster heroes are the signature look (from the club's IG graphics).

---

## 10. MVP scope additions (build in v1)

These were promoted into MVP after the core spec. Each notes the bit that keeps the later enhancement from being a retrofit.

**Push notifications (MVP — infrastructure).**
Build the push pipeline in v1: permission prompt, store the device push token on the profile (or a `push_tokens` table for multi-device), and send via a Supabase Edge Function (e.g. on a new fixture, or an admin "remind unanswered" action). **Platform reality, documented and accepted:** on a PWA, push is solid on Android and **unreliable on iOS** (Apple only partially supports web push and periodically breaks it). MVP ships push working properly on Android and patchily on iPhone. If reliable iPhone push becomes essential, that is the trigger to Capacitor-wrap (the send logic is reused, only the client token registration changes). NB: this is distinct from the AI **WhatsApp-nudge drafting** (post-MVP, §12) — push = the app pings the phone; nudge = AI drafts a message to paste into WhatsApp.

**Weather on fixture cards (MVP).**
As specced in §12: Open-Meteo (free, no key), geocode the venue once to lat/long and store it, only fetch inside the ~7–14 day forecast window, cache via a scheduled Edge Function, render a small strip (icon + temp + rain chance) on the card/detail header. Add `venue_lat`, `venue_lng`, and a cached `forecast` (jsonb + fetched_at) to the fixture.

**Payments / subs — MVP version.**
A simple **paid / not-paid toggle per player per fixture, admin-only**. Model it as its own table now, not a flag on availability, so the enhanced version (amounts, balances, Manager Float tie-in) grows in without a retrofit:
```
payments
  id uuid pk default gen_random_uuid()
  fixture_id uuid references fixtures(id) on delete cascade not null
  profile_id uuid references profiles(id) not null
  paid boolean not null default false
  -- LATER (enhancement): amount numeric, paid_at timestamptz, method text, note text
  unique (fixture_id, profile_id)
```
RLS: SELECT authed in club; write **admin only**. Surfaced in the fixture detail / who's-in view for admins as a paid toggle next to each available player. Match fee stays £7. Enhancement (post-MVP): sum paid, running balance over fixtures, per-player season balance.

**Per-fixture CSV export (MVP, admin).**
On a fixture, an admin "Export CSV" action. Built client-side (assemble the CSV string, trigger a download — no server needed). Contents:
- **Header line(s):** fixture details — team, opponent, home/away, date, kickoff, venue, type/league.
- **Then one row per player marked `in` (available only):** full name, preferred position, Paid (Yes/No, from the payments table).
- Filename like `nottsmvf_<team>_<opponent>_<date>.csv`.

---

## 11. Parked / post-MVP (don't build in v1, but design so they slot in)

- WhatsApp-nudge **drafting** and other **AI features** (see §12) — the Claude integration.
- Payments enhancement: amounts, running balances, per-player season balance, Manager Float tie-in.
- Player-facing season stats on own profile; club leaderboard sharing.
- Share fixture/result as a club-styled image to WhatsApp.
- iCal / Google Calendar export.
- Real "played"/selected-XI capture distinct from availability.
- Media-only role.
- League-table auto-calculation (only possible with a league data feed; manual is correct until then).

---

## 12. Technical decisions & enhancement notes (CTO)

### Supabase over Neon — settled
Both are Postgres underneath. Neon is *only* Postgres (serverless, branching, scale-to-zero) — you'd then bolt on auth, storage, RLS tooling and realtime from elsewhere and wire them together. Supabase bundles all of those natively. The deciding factor is the security model: the entire eligibility-gate and admin-permission design (§4) is built on Postgres RLS tied to `auth.uid()` — that auth-to-DB binding is exactly what Supabase is built around and what you'd hand-roll on Neon. For a £0–5/month club app, Neon would mean rebuilding the spine of the security model from parts for no payoff. Neon would only win on serverless-function-heavy workloads with long idle periods and DB branching in CI — not this. **Stay on Supabase.** (Also note: the two enhancements below both depend on Supabase Edge Functions, which Supabase gives natively and Neon does not.)

### AI features — pattern and scope
All AI calls go through a **Supabase Edge Function**, never the browser. The browser calls your edge function → the function calls the Anthropic API with the server-side key → returns text. This keeps the API key off the client and lets you control/cap cost. Use `claude-sonnet` class for cost/quality balance; keep prompts tight and outputs short.

Build only the AI features that do something a glance at the stats page can't. Worth doing:
- **Availability-nudge drafting** — "draft a WhatsApp chasing the lads who haven't replied for Sunday" in the club's voice. Plays to the existing WhatsApp workflow; saves time weekly.
- **Match-report / social copy** — feed result + scorers + MOTM, get a FULL-TIME caption in the club's tone (mirrors the IG graphics workflow).
- **Squad-selection prompts** — pattern-spotting across availability + positions ("light at the back this week — only 2 of 4 defenders available"), which is tedious to eyeball.

Resist: predictive form analysis, "AI tactical suggestions", win-probability. On ~8-game samples that's noise dressed as insight and makes the app try too hard.

These are **post-MVP**. Ship the core first; AI is an enhancement to a working thing.

### Weather on fixture cards — approach
Cheapest genuine win; relevant for an outdoor Sunday-league app.
- **Free API:** Open-Meteo (no key, generous limits) is the default pick; OpenWeatherMap as fallback.
- **Geocode the venue once** (address/what3words → lat/long) and store it on the fixture/venue, rather than geocoding on every fetch.
- **Only fetch inside the forecast window** (~7–14 days out). No weather strip on fixtures further out — the forecast doesn't exist yet.
- **Cache it.** Fetch once or twice a day per upcoming fixture via a scheduled Edge Function, store the result, render the stored value. Don't call the API on render.
- Show as a small strip on the fixture card / detail header (icon + temp + rain chance).

Post-MVP, self-contained, no impact on the core schema beyond an optional cached-forecast field and venue lat/long.

### Sequencing discipline
None of the above changes the stack or the build order. Ship core (auth, fixtures, availability, results, stats) → prove it with the squads → then layer weather and AI. They're enhancements, not part of the spine.

---

## 13. First message to Claude Code

Drop this doc, `notts-mvf.html`, `DESIGN-SYSTEM.md`, `UX-AND-IA.md`, `DESIGN-RESEARCH.md`, `BUILD-LIST.md`, `PERSONAS-AND-STORIES.md`, and `GLOSSARY.md` into the project. Open with:

> "Build the Notts MvF team hub per HANDOVER.md. The prototype notts-mvf.html is the UI/UX, copy, and behaviour reference — match it for structure and behaviour, but take fonts and palette from DESIGN-SYSTEM.md (the prototype's Anton/red-brown are first-draft and have been superseded), and ignore its in-memory state, fake auth, and placeholder SVG crest. UX-AND-IA.md leads on layout and flow (note especially: Fixtures is the persona-tuned landing/action surface and availability is one-tap from the hero and from notifications). DESIGN-SYSTEM.md has the exact tokens (Clash Display / Hanken Grotesk / Geist Mono / Fraunces accent, charcoal + red/green palette, grain, no concentric motif). PERSONAS-AND-STORIES.md gives the acceptance criteria; GLOSSARY.md locks the domain terms and British-football language. Start at build order step 1: walk me through creating the Supabase project, then write the schema + RLS migration and we'll test the policies with two users before building any frontend. British football vernacular throughout."
