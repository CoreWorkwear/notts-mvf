# Notts MvF — Backlog

Lightweight holding pen for things we've consciously deferred, so nothing's lost.
Candidate to migrate into **Linear** when we set that up (see note at the bottom).

Status legend: 🅿️ parked (do later) · 🔒 security/privacy · 🚧 needs sign-off

---

## Motion / design polish (🅿️ "maybe" list — only if they earn it)
Deliberately parked after the motion pass — the app already reads premium; these
risk the "busy" feeling we explicitly avoided. Revisit only with a concrete reason.
- **Tap micro-interactions** — springy press feedback on primary buttons/chips
  beyond the existing CSS `:active` scale.
- **Number count-ups** — animate figures rolling up (stats totals, Golden Boot)
  the way the score-bug / Who's-In count already do.
- **Extra serif flourishes** — the Instrument Serif accent is used in just one spot
  (the hero "v"). The guide allows it as a *rare* flourish (a "Full Time" moment,
  Golden Boot). Keep rare; overuse kills it.
- **Signature diagonal / red-green split device** (DESIGN-SYSTEM §4) — currently
  only on the crest; the guide wants it as a recurring graphic signal (e.g. the
  diagonal where a hero photo meets a card).

## Security / privacy
- 🔒 **Profiles column-level PII exposure.** RLS on `profiles` is row-level: any
  authenticated club member can `select` *every* column of *every* club profile —
  including `email`, `phone`, `dob`, `ec_name`, `ec_phone`. The app doesn't surface
  this (admin-only screens use `usePlayers`; the player-facing Squad page uses the
  PII-free `useSquad`), but a member could still craft the query directly. Proper
  fix: restrict columns for non-admins — e.g. a public `squad` view, a split
  contact table, or column privileges + a SECURITY DEFINER accessor. Sizeable; flag
  before any wider rollout.

## Features
- 🚧 **§4.2 — FM-style depth chart.** The Squad page's second view. **Gated on
  phone-UI sign-off** before building (per the batch-3 brief).

---

### Tooling note
Chris flagged wanting proper backlog tooling (**Linear**) rather than a markdown
file. When that's set up, migrate these items across and retire this doc. Linear
MCP is available in-session but needs workspace auth to wire up.
