# Notts MvF — UX & Information Architecture Pass

Companion to HANDOVER.md, DESIGN-SYSTEM.md and PERSONAS-AND-STORIES.md. This is the *interaction* thinking — what each person sees, in what order, and how the most-used jobs are made effortless. Visual design (the other docs) is the skin; this is the bones. Written after a deliberate pass to stop the app being beautifully-dressed but generically-structured.

**Governing principle:** the layout is curated around *intent frequency*. The jobs people do every week get the fewest taps and the most prominence; the things they look at occasionally (stats, match centre) stay rich but recede in the hierarchy. Bias to the weekly jobs.

---

## 1. The core insight — Fixtures *is* the home, and it's an action surface

Everyone lands on **Fixtures**. But Fixtures is not a passive list — it's the primary action surface. The single most-frequent job in the whole app is a player answering "am I about for the next game?", so that action lives **on the surface, not one sheet deeper**.

- The **next relevant game** sits at the top as the poster hero.
- The hero **carries the in / maybe / out control directly** — one tap, no drill-in, with the saved confirmation inline.
- The detail sheet still exists for the fuller picture (venue, directions, weather, who's in, subs) but is never *required* to do the common thing.

This collapses the old five-action availability flow (open → find → tap fixture → find tab → tap status) into **one tap from the screen you already land on**, and from a push notification (see §4). It also means we don't need a separate "Home" tab — fewer screens, less nav, the thing you see first is the thing you act on.

---

## 2. Per-persona hierarchy — what each sees first

Same Fixtures screen, but what's surfaced is tuned to who's looking. This is the "bespoke to the personas" requirement made concrete.

### The Player (XL or Community)
Lands on Fixtures. Top to bottom:
1. **Next game hero** — opponent, date, KO, home/away, weather (if in window), and a prominent **in / maybe / out** control with their current answer shown. If they haven't answered, the control gently pulses / is the visual focus.
2. A compact **"you're in for 2 of the next 3"** style status line so they know where they stand without thinking.
3. The rest of their upcoming games as strip rows, each showing their own availability state at a glance (a coloured dot/edge), tappable to change inline or open detail.
- A Community-only player only ever sees Community games (eligibility gate). A both-teams player sees both, with the team filter available.
- **What's de-emphasised for players:** counts of who else is in (available but secondary), admin tooling (absent).

### The Gaffer (Admin)
Lands on the same Fixtures screen, but the hero and the framing shift to *management intent*:
1. **Next game hero** — same poster, but instead of a personal in/out, it leads with the **squad state**: "9 in · 3 maybe · 4 not replied", tappable straight to the who's-in / chase view.
2. A subtle **"needs doing" strip** when relevant: fixtures with no result logged, games inside 48h with low numbers, subs outstanding. This is the gaffer's Sunday-night to-do without being a separate dashboard.
3. Upcoming games as rows, each with live in/maybe/out counts.
- Admin actions (add fixture, edit, log result, mark subs) are reachable from here and from each fixture, not hidden in a separate admin area.
- The gaffer is *also* a player in many cases — their own in/out is still available, just not the lead element.

> This is the one screen, two intents model: same architecture, persona-tuned emphasis. Cheaper to build and less confusing than separate home screens, and it's genuinely responsive to who's holding the phone.

---

## 3. The weekly-jobs budget — where the rigour goes

Ranked by frequency, design effort follows this order:
1. **Set my availability** (every player, every week) — one tap on the hero; instant, confirmed, reversible. The most-polished interaction in the app.
2. **See who's in** (gaffer every week, players often) — the signature "team-sheet" view: the XI filling up, the count, the not-replied list ready to chase. Lean-forward, not a static table.
3. **Chase the non-repliers** (gaffer, weekly) — from who's-in, a one-tap "remind unanswered" (push in MVP; AI-drafted WhatsApp message post-MVP). This is a real weekly pain; make it a button, not a manual job.
4. **Mark subs paid** (gaffer, weekly) — a fast paid/not-paid toggle per player on the fixture, and the CSV export. Utilitarian, quick, no friction.
5. **Log a result** (gaffer, weekly in-season) — quick entry, squad-pick scorers, MOTM.
6. **Look at the table / stats** (everyone, occasionally) — rich and beautiful, but *deliberately* further down the priority list. Lean-back screens. They get the visual love (golden boot, bars, match centre) but not the interaction-budget priority.

The trap we're avoiding: over-investing in the lean-back spectacle (match centre, stats) at the expense of the lean-forward weekly grind (availability, subs, chasing). Both matter; the weekly jobs come first.

---

## 4. Notifications as a one-tap action surface (MVP infra)

Push isn't just an alert, it's a shortcut to the most common action:
- "New game v Carlton, Sun 13:00 — **are you in?**" with **In / Maybe / Out actions on the notification itself** (Android notification actions; best-effort on iOS). Tapping In resolves availability without even opening the app.
- Gaffer reminder action ("4 lads haven't replied — nudge them") fires the chase.
This is the logical extension of the on-surface availability principle: the fastest path to "in" is from the notification, the next fastest is the hero, the detail sheet is only for the full picture.

---

## 5. Cold-start vs in-season — design for both states

The app looks very different in pre-season (no results, empty table, few fixtures) versus mid-season (40 results, full table, rich stats). Design for the *transition*, not just the full state:
- **Empty/cold states carry their weight** — a pre-season Fixtures screen with one friendly still feels intentional ("Season's coming — first friendly's in"), not broken. Club voice, never "No data".
- **Stats / table / match centre gracefully scale from zero** — a golden boot panel with no goals yet shows an inviting empty state, not a blank card. The first result logged should feel like an event.
- **Progressive richness** — sections that are empty early (stats, table) sit lower or collapse until there's something to show, so a new club isn't staring at a page of empty modules.

---

## 6. Concrete layout decisions (folding into DESIGN-SYSTEM + HANDOVER)

- **Fixtures = landing + action surface** for all roles; no separate Home tab.
- **Availability control lives on the next-game hero** (one tap), and on each upcoming row (inline), as well as in the detail sheet.
- **Hero is persona-tuned:** personal in/out lead for players; squad-state + "needs doing" lead for admins.
- **Who's In is the signature lean-forward screen** (team-sheet fill, count, chase button).
- **Subs** get a fast, low-friction toggle on the fixture; CSV export adjacent.
- **Results, table, stats** keep their visual richness but sit lower in interaction priority; they're where the poster-hero spectacle pays off for the occasional deep look.
- **Notifications carry inline In/Maybe/Out actions** (MVP infra; Android solid, iOS best-effort).
- **Every empty state is designed and in club voice**; modules scale from zero.

---

## 7. What this changes in the other artefacts
- **HANDOVER §5 (Screens):** Fixtures described as the persona-tuned landing/action surface; availability promoted to an on-hero/on-row/on-notification action, not detail-only; "needs doing" admin strip added; empty-state requirement called out.
- **DESIGN-SYSTEM:** the next-game hero spec gains the inline availability control and the two persona variants; "Who's In team-sheet" reaffirmed as the priority signature moment; empty-state design added as a first-class concern.
- **PERSONAS-AND-STORIES:** acceptance criteria tightened — "set availability in one tap from the home screen and from a notification" becomes an explicit done-when.
- **BUILD-LIST / HANDOVER build order:** notification inline-actions and the chase action noted; subs kept in the weekly-jobs tier.
