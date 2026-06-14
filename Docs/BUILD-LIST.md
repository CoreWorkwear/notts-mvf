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

- `opponents` table: id, club_id, name, badge_url.
- `media_assets` table: id, club_id, type ('photo'|'crest'), url, uploaded_by, created_at.
- `fixtures`: add optional `pinned_image_id` (FK to media_assets, null = random).
- `profiles`: add `photo_url`, plus the already-agreed `dob`, `ec_name`, `ec_phone`, `active`.
- Club crest: a row in media_assets (type 'crest') or a field on the `clubs` table.
