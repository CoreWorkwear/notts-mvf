# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The real, multi-user, deployable team-management app for **Nottinghamshire MvF** — a Sunday-league football club with one club and two teams: **XL 11s** (first team, red) and **Community** (reserves, green). React + Vite SPA talking to **Supabase** (Postgres + Auth + RLS + Storage), deployed as a PWA on Cloudflare Pages. Dark-first, mobile-first.

`Docs/` is the source of truth and the spec — read it before building. On any conflict: **HANDOVER.md** leads on data/security/scope and holds the numbered build order (§8); **UX-AND-IA.md** leads on layout/flow; **DESIGN-SYSTEM.md** leads on look (tokens, fonts, palette); **GLOSSARY.md** locks the domain terms; **PERSONAS-AND-STORIES.md** holds the "done when…" acceptance criteria. `Docs/notts-mvf.html` is the original clickable prototype — a behaviour/copy reference only (its fonts/palette are superseded by DESIGN-SYSTEM, and its in-memory state/fake auth/placeholder crest are ignored).

**British football vernacular throughout — never Americanised** (fixtures/results, pitch, kit, nil; never soccer/field/schedule/roster). This is a hard rule for all UI copy, empty states, and notifications. **Club preference (overrides the older GLOSSARY wording): use "Manager" not "Gaffer", and "players" not "the lads".**

## Commands

Node lives at `C:\Program Files\nodejs` (on the user PATH; the **Bash tool has no Node — use the PowerShell tool for npm**). If a shell predates the PATH fix, prefix: `$env:Path = "C:\Program Files\nodejs;" + $env:Path`.

- `npm install`
- `npm run dev` — Vite dev server on port 5173 (honours `PORT`). Prefer launching via the Claude Preview MCP (`.claude/launch.json` invokes node by full path to dodge PATH issues).
- `npm run build` — production build to `dist/` (also the quickest way to typecheck/compile-verify).
- `npm run preview`

**No JS test runner exists.** The closest thing to tests is the SQL RLS harness. Database work is done by hand in the Supabase **SQL Editor**, in this order (see `supabase/README.md`):
1. `supabase/migrations/0001_init_schema_and_rls.sql` (+ later numbered migrations, e.g. `0002_*`)
2. `supabase/seed.sql`
3. `supabase/tests/rls_test.sql` — self-verifying, runs in a transaction that **rolls back**; success prints `ALL RLS TESTS PASSED` in the Messages tab.

When changing the DB, **add a new numbered migration file** under `supabase/migrations/` and have the user run it in the SQL Editor (these are not yet under Supabase CLI migration tracking). The app reads/writes new columns immediately, so an unrun migration breaks queries.

## Architecture

### Security model — RLS *is* the security
The anon key ships in the client (`.env` → `VITE_SUPABASE_*`); every rule is enforced at the database via Row-Level Security, not in React. **Never implement an access rule only in the frontend.** Key pieces in `0001_init_schema_and_rls.sql`:
- `is_admin(uid)`, `current_club_id()`, `can_select_fixture(fixture_id, uid)` — `security definer` helpers used inside policies.
- **`can_select_fixture` is the single source of truth for the XL eligibility gate**, used by both the `fixtures` SELECT policy *and* the `availability` write policies. A Community-only / non-XL-eligible player simply never receives XL fixtures from any query, and cannot write availability for them.
- `handle_new_user` trigger creates the `profiles` row + `team_memberships` from signup metadata and **always forces `role='player'`, `xl_eligible=false`** server-side.
- `protect_profile_columns` trigger: non-admins can't change role/eligibility/active/club_id; **nobody can demote or deactivate themselves**; `postgres`/`service_role` bypass so the **first admin is bootstrapped by hand** in the Table editor (set `profiles.role='admin'`).
- Multi-tenant-ready: `clubs` is the root, every owned row carries `club_id`; one club is seeded and the trigger resolves it.

### Frontend
- Provider order (in `src/main.jsx`) matters: `ErrorBoundary > ThemeProvider > AuthProvider > SeasonProvider > App`. Season queries depend on Auth; the season scopes most data fetches.
- **Fixtures is the landing/action surface for everyone** (no Home tab). The next-game hero is persona-tuned: player = one-tap in/maybe/out inline; manager = squad-state. Nav is role-gated (admins also get Who's In + Players).
- **Design tokens are the single source of truth** in `src/styles/tokens.css`: dark is default, `[data-theme="light"]` is the on-brand alternate, brand red (XL) / green (Community). Reference CSS vars (`var(--red)`, `var(--coal)`, etc.) — don't hardcode or re-derive colours per component.
- Data hooks `src/hooks/useFixtures.js` and `useResults.js` do the season-scoped fetches and enrich rows; first-cut "realtime" is refetch-on-focus.

### Two things that bite
- **Bottom sheets must stay mounted with `open` toggled** (the pattern in `Sheet`/`useSheetBack`). Do **not** conditionally mount a sheet in the open state — under StrictMode the double-invoked mount effect fires `history.back()` and the sheet snaps shut. To reset a form for a new target, clear its fields in a `useEffect` keyed on `open` (see `FixtureForm`/`ResultForm`), not by remounting.
- **All match-lifecycle timing is reckoned in Europe/London (GMT/BST aware)** via `fixtureConcluded`/`hasKickedOff` in `src/lib/format.js`. A fixture stays in Fixtures until **kickoff + 4h**, then moves to Results (needs-a-result, or P-P for a `postponed` fixture); logging a result moves it immediately.

### Data conventions
- **Stats key by `profile_id`, not name.** Scorer/assist/MOTM resolve to a squad member's id when the typed name matches, falling back to a free-typed string for guests (`resolveName` in `useResults.js`). Appearances are currently proxied from `availability='in'`.
- Removing a player is a **soft delete** (`active=false`), never a hard delete — preserves results history.
- Positions are a frontend constant (`src/lib/constants.js`), not a table.

## Progress & state

The numbered build order is `Docs/HANDOVER.md` §8; current progress and environment quirks are tracked in the project memory (`memory/notts-mvf-build-state.md`, `memory/notts-mvf-dev-env.md`). Commit only when the user asks.
