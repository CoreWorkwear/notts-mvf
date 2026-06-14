# Notts MvF — Build List (Stage 2 / post-prototype)

Running capture of everything agreed but **not yet in the prototype**, plus parked ideas. Feeds the handover rewrite. The prototype (`notts-mvf.html`) is the UI/UX reference; this is the list of what the real Supabase build adds on top.

---

## A. Media & branding system (NEW — agreed this session)

The club's Instagram look (NEXT UP / FULL TIME poster graphics) is the visual target. The app should pull from real club assets so it feels like the club, not a generic template.

**Club photo pool**
- A library of club photos uploaded by admins, used as poster backgrounds behind the fixture hero, result hero, and detail/match-centre headers.
- Selection: **random from the pool by default**, so posters stay fresh without per-game work. An admin can optionally **pin a specific photo** to a specific fixture/result to override the random pick.
- Needs: upload, delete, and a simple gallery view. Store images in Supabase Storage, reference by URL.

**Opponent badges**
- Each opponent has a crest/badge image, set **once per opponent** (not per fixture). Every fixture vs that opponent reuses it.
- Replaces the current dashed-monogram placeholder.
- Implies an `opponents` table (name + badge URL) rather than opponent being free-text on each fixture. Migration note: existing free-text opponents become rows.

**Club crest swappable**
- Our own crest is an uploadable asset, not hard-coded, in case branding changes.

**Per-player photos**
- Headshot-style photo per player (the feed has these). Shows on player profile and optionally in the squad list / match centre.
- Store in Supabase Storage, URL on the profile record.

**Permissions**
- Admins manage all media. **No separate media role for now** — the social media person is made an admin.
- NOTE / future option: a media-only role (upload/cycle images, no access to fixtures/results/player data) is the cleaner long-term answer if image duties go to someone who shouldn't touch squad data. Same permissions layer as everything else, so it can be added later without rework. Flagged, not built.

**Data/asset notes**
- All images in Supabase Storage (free tier covers this at club scale). Compress/resize on upload to keep posters fast on mobile data.
- Poster backgrounds need a dark gradient wash over them (already in the prototype) so the white display type stays readable over any photo.

---

## A2. Opponents admin panel (NEW — agreed this session)

The `opponents` table already exists in the schema (a badge attaches to the opponent, not each fixture — set Carlton once, every Carlton game reuses it). What's missing is the admin *screen* to manage it, the same shape as the Players admin. So this is a CRUD screen over an existing table plus the badge upload, not new architecture.

**What it does**
- List all opponents the club knows: ones pre-loaded for the current league, ones we've played before (kept in history), and any added ad hoc.
- Add a new opponent; edit an existing one (name, home ground / venue, and **team logo/badge** via upload — ties into the media system, `media_assets` type `opponent_badge`, replacing the dashed-monogram placeholder).
- Opponents persist across seasons — playing a team again reuses the same record (and its badge), building up history rather than re-typing.

**Product nuance (don't skip this):** opponents come in two flavours. **League teams** you'll play repeatedly — worth full detail and a badge. **One-off friendly opponents** you may never face again — minimal detail. The panel should let you add a quick name-only opponent without forcing a full profile + badge on every casual fixture, but allow enriching one later if it becomes a regular. That distinction is what makes the panel feel tailored rather than a chore.

**Schema:** `opponents` already has id, club_id, name, badge_url. Add (if not present) `home_venue text` and optionally `is_league_team boolean default false` to drive the league-vs-one-off distinction. Admin-only write (RLS).

**Where it lives:** an admin screen, reachable like Players. Add-fixture's opponent field becomes a pick-from-opponents (with "add new" inline) rather than free text, so fixtures link to a real opponent record.

---

## A3. Seasons admin + season rollover (NEW — agreed this session)

Seasons already exist in the data (everything is stamped with one; there's a season picker). What's missing is the admin journey to *create* a season and define when it runs — and to roll over cleanly into a new one.

**What it does**
- Admin can **create a new season** with a label (e.g. "2026/27") and **start + end dates**.
- Set which season is current (`is_current`). Knowing the dates makes other things smarter: new fixtures auto-default to the right season; the app can show "season's coming" vs "season's on" empty/cold states (already called for in UX-AND-IA §5); stats/table scope correctly.
- Past seasons stay viewable in history via the existing season picker.

**The meaty bit — season rollover (design deliberately, don't just add a date field):** when you start a new season, decide what carries and what resets.
- **Players carry forward** — the squad persists across seasons (with an optional prompt to mark who's left → `active=false`, so leavers drop off without losing history).
- **Opponents carry forward** — they're season-independent (see A2).
- **Fixtures, results, goals, league table, stats start fresh** for the new season, while the old season's data stays intact and viewable in history (everything's already keyed by `season_id`, so this is about *scoping views to the current season*, not deleting anything).
- The league table is per-season already (manual grid) — a new season starts with an empty table to fill in.

**Schema:** `seasons` already has id, club_id, label, is_current. Add `start_date date` and `end_date date`. Admin-only write (RLS).

**Sequencing:** build *after* the core MVP screens are solid. Opponents admin (A2) pairs naturally with the Players admin work (Step 9) since it's the same CRUD pattern; seasons admin can follow. Neither should interrupt the core spine.

---

## B. Deferred from earlier sessions (agreed, parked)

**Player season stats (player-facing)**
- Games played, goals, assists per player across the season. The data already exists in results/goals — this is a read/aggregation view, not new capture.
- Surface on the player's own profile, and optionally a club leaderboard.

**Live updates / pull-to-refresh**
- Supabase real-time subscriptions so availability and results update without a manual refresh. Pull-to-refresh as the fallback gesture.

**Share to WhatsApp as an image**
- Generate a shareable graphic (fixture or result) styled like the club's posters, for dropping into the WhatsApp groups. Ties directly to the existing social workflow.

---

## C. PWA & platform (agreed)

- Ship as a **PWA on Cloudflare Pages** for v1. Installable to home screen, full-screen, both platforms.
- Architect clean so **Capacitor wrap** to App Store / Play Store is a later option, not a rewrite.
- **Push notifications**: post-MVP. iOS PWA push is unreliable, so if reliable push becomes day-one critical, that's the trigger to Capacitor-wrap. WhatsApp covers nudges until then.
- PWA setup needed: manifest, icons from the crest, service worker, install prompt.

---

## D. Already in the prototype (for reference — these are DONE in the UI, need the real backend)

- Auth (login/register), player + admin roles, admin-creates-admin, can't demote/deactivate self.
- Two teams (XL 11s red / Community green), team membership as a list, XL eligibility gate.
- Fixtures: list + calendar views, detail sheet with My availability / Who's in tabs, add/edit/remove (admin).
- Availability: in / maybe / out, per fixture, with save confirmation.
- Results: dedicated tab, FM-style match centre (FT/HT score, goal timeline with scorer/assist/minute, MOTM, squad that played), admin result entry with squad-pick-or-free-type, "needs a result" prompts.
- Players admin: full record (name, phone, DOB, email, emergency contact, positions, preferred, teams, XL flag, role), add manually, password reset (not view), active/inactive (kept for history).
- Mobile-first: bottom nav, bottom-sheet modals, hardware-back closes sheets, safe-area handling.

---

## E. Data model additions implied by this session (for the schema)

- `opponents` table: id, club_id, name, badge_url — **add** `home_venue text`, `is_league_team boolean default false` (A2).
- `seasons` table: id, club_id, label, is_current — **add** `start_date date`, `end_date date` (A3).
- `media_assets` table: id, club_id, type ('photo'|'crest'|'player_photo'|'opponent_badge'), url, uploaded_by, created_at.
- `fixtures`: add optional `pinned_image_id` (FK to media_assets, null = random).
- `profiles`: add `photo_url`, plus the already-agreed `dob`, `ec_name`, `ec_phone`, `active`.
- Club crest: a row in media_assets (type 'crest') or a field on the `clubs` table.
