# Notts MvF → Platform: Future Architecture & Roadmap

Companion to HANDOVER.md. Captures the foundational thinking for two future directions —
a **league-manager mode** and **white-label multi-tenant distribution** — so the
decisions are *made and recorded* now, ready to execute later as a deliberate project.

**Status: DOCUMENT ONLY. Build nothing structural from this yet.** Notts MvF is going
live on the current codebase; the worst time to re-plumb foundations is at launch. This
is the blueprint for when the league project is properly scoped and started. See §7 for
the one small "don't paint into a corner" guidance that *does* apply to current work.

---

## 1. The two directions, and why they're one problem

**Direction A — League manager.** A mode where a league admin sets up and runs a league;
clubs join (by invite); fixtures, results and a league table aggregate across all the
clubs in that league; clubs can view each other's fixtures and results.

**Direction B — White-label multi-tenant.** Launch on the app stores as a white-label
product: many clubs, each in their own space, not seeing each other's data.

These look separate but collide at the data model. B wants clubs **isolated** (walled
gardens, can't see each other). A wants clubs **sharing** (a common table, visible
fixtures/results). **If you build B's isolation hard without accounting for A's sharing,
you wall clubs off so completely that adding leagues later means tearing up the security
model.** Resolving that tension is the whole point of this document.

---

## 2. Decisions locked (from the product owner)

- **One app, many leagues inside it.** Not one-app-per-league. Clubs join a league **by
  invite from the league admin** (not open self-signup — the league controls its members).
- **A club can be in multiple leagues at once** (e.g. a league *and* a cup). This is the
  decisive constraint — see §3.
- **A league admin may be league-only, OR also run a club** (one person, two hats).
- **Sequence: document now, build later.** Scaffolding becomes phase one of the league
  project, not a retrofit into the live launch app.

---

## 3. The data model shape (the expensive-to-retrofit bit)

### 3.1 A league tier sits ABOVE clubs
A new `leagues` table, above `clubs`. The current schema already roots everything at
`clubs` with `club_id` everywhere, so the league tier is an *addition above* what exists,
not a rewrite of it. That's why the retrofit cost is modest — the hard part (per-club
tenancy) is already done.

```
leagues
  id uuid pk
  name text
  -- season handling: leagues run seasons too; reuse/extend the seasons concept
  created_at timestamptz
```

### 3.2 Club↔league is MANY-TO-MANY (a join table, NOT a parent column)
Because a club can be in several leagues at once, "which league does this club belong to?"
has no single answer. So you CANNOT put a `league_id` column on `clubs`. It must be a
join table:

```
league_memberships
  id uuid pk
  league_id uuid references leagues(id)
  club_id   uuid references clubs(id)
  team_id   uuid references teams(id)    -- which of the club's teams plays in this league
  season_id uuid                          -- membership is per-season
  status text                             -- 'invited' | 'active' | 'left'
  unique (league_id, team_id, season_id)
```

Note it's keyed to **team**, not just club — this also cleanly supports "a club's two
teams are in different leagues" (First Team in the county league, Reserves in the Sunday
league) without extra work. Getting this many-to-many shape right is the single most
important foundational call; a parent-child column here would have to be torn up later.

### 3.3 Fixtures/results gain a league context
A fixture played *in a league* needs to know which league, so results can roll into the
right table. Add an optional `league_id` to fixtures (null = a friendly / non-league game,
which already exists). The league table for a league/season is then computed-or-manual
across all member clubs' results — a step up from today's single-club manual table.

---

## 4. Contextual roles (the other expensive-to-retrofit bit)

**Today:** `role` is a single column on `profiles` ('player' | 'admin') — effectively
global to the person within their club.

**Problem:** one human can be a **league admin**, a **club admin**, AND a **player**
simultaneously, in different contexts. A global role can't express that.

**Future shape:** roles become *grants scoped to a context*, not a property of the person.

```
role_grants
  id uuid pk
  profile_id uuid references profiles(id)
  scope_type text      -- 'club' | 'league'
  scope_id   uuid      -- the club_id or league_id this grant applies to
  role       text      -- 'admin' | 'manager' | 'player' | 'league_admin'
  unique (profile_id, scope_type, scope_id, role)
```

So "Chris is admin **of club X**", "Chris is league_admin **of league Y**", "Chris is a
player **in club Z**" are three separate grants. **This is the invasive one** — every RLS
policy today assumes the single `role` column, so this touches the entire security model
(the eligibility gate, admin-only writes, self-lockout). That's exactly why it must NOT
be done at launch — it would rip up proven security for an undesigned feature. It's
phase-one work of the league project, done deliberately, re-proven with the RLS harness.

---

## 5. The data-sharing boundary (the security crux — get this right or leak private data)

**The single most important security question of the whole roadmap:** when a club joins
a league, *exactly what becomes visible to the other clubs in that league?*

This is the league-tier equivalent of the XL eligibility gate, and deserves the same
three-way-proof rigour. Draw the line explicitly and enforce it in RLS:

**SHARED across the league (other clubs can see):**
- Fixtures involving league teams (so everyone sees the schedule).
- Results / scores of league games (needed for the table).
- The league table itself.
- Club name, crest, team names — public-facing identity.

**PRIVATE to the club (NEVER visible to other clubs or the league admin):**
- Player personal data: phone, email, DOB, emergency contacts.
- Availability (who's in/out).
- Subs / payments.
- Internal line-ups *before* a game (arguably), squad management, internal notes.
- Player avatars? (decide — probably club-internal.)

**Rule of thumb:** *match-facing* data is shared; *squad-management and personal* data
stays walled in the club. The league sees outcomes, not people's phone numbers. This
boundary must be written into RLS policies and proven with a test harness (a club admin
in league Y must NOT be able to read club X's player contacts) before any league feature
ships.

---

## 6. Build-now vs defer (the safe sequence)

**NOT NOW (defer to the league project, when scoped):**
- Everything structural in §3 and §4 (league tier, membership join, contextual roles).
- All league *features*: the league-admin UI, the invite flow, cross-club fixture/result
  views, aggregated league tables, competition types (league vs cup), promotion/relegation.
- White-label theming/tenant-config beyond what exists.

**Reason:** the features aren't designed yet (building scaffolding for a vague feature
usually means building the *wrong* scaffolding and paying the retrofit cost anyway, plus
the wasted speculative build). And the invasive changes (contextual roles especially)
must not destabilise the live launch.

**WHEN YOU DO IT** — order within the league project:
1. Design the league features properly (scope the UI and flows first).
2. Lay the schema scaffolding (§3) — additive, low-risk.
3. Migrate to contextual roles (§4) — invasive; re-prove the entire RLS harness after.
4. Implement the sharing boundary (§5) with its own proof harness.
5. Build league-admin features on top.
6. White-label tenant config / theming.

---

## 7. The ONE thing that applies to current work

While building the current feature batches, **don't paint into a corner** — but don't
add league structure either. Concretely, a standing instruction for Code:

> "Keep `club_id` tenancy scoping clean and consistent on all new tables/queries. Don't
> hardcode assumptions that there is only ever one club, one league, or that a person has
> a single global role. Don't build league structure now — just don't make it harder to
> add later."

That costs nothing, keeps doors open, and is the entire extent of future-proofing that
belongs in the launch codebase.

---

## 8. Open questions to resolve when the project starts
- League seasons vs club seasons — same `seasons` concept extended, or league-owned?
- League table: auto-computed from member results, or league-admin-confirmed (handles
  disputes/walkovers)? (Today's single-club table is manual — leagues may want auto with
  an admin override.)
- Competition types: league (table) vs cup (bracket) — different result handling.
- Invite flow: how a league admin invites a club, and how a club accepts.
- White-label: per-tenant theming (crest, colours, name) — how much is configurable vs
  rebuilt per client; app-store distribution (one app with tenant selection, or per-client
  builds via Capacitor).
- Billing/commercial model for white-label tenants (out of scope here, but it shapes
  tenancy boundaries).
