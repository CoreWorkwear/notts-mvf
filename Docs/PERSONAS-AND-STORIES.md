# Notts MvF — Personas & User Stories

Companion to HANDOVER.md. Defines **who** the app is for and the **"done when…"** acceptance criteria for each core job. Build against these — a feature is finished when its stories pass, not when the screen looks right. British football vernacular throughout (see GLOSSARY.md).

---

## Personas

**The Gaffer (Admin).** Chris W, Scott Hall, Chris Wells and other managers/assistants. Runs the club from a phone, usually pitchside or on the sofa Sunday night. Wants to set fixtures fast, see who's about, log results, and chase the lads who haven't replied. Not technical, low patience for faff. Some admins also handle social media and need to drop in club photos and opponent badges.

**The XL Player (first team).** An XL-eligible squad member. Plays for the first team, maybe the reserves too. Wants to know when the next game is, where it is, what the weather's doing, and to tap whether he's in. Will check who else is about and have a look at the stats for bragging rights.

**The Community Player (reserves).** Plays Community only, not XL-eligible. Same wants as above, but must only ever see Community fixtures — XL games are invisible to him until an admin signs him off.

**The New Lad.** Just found the club through MvF. Registers himself, lands as a Community-or-both player, not eligible for XL. Needs registration to be under two minutes and obvious.

---

## User stories & acceptance criteria

### Auth & profile
- **As a new lad, I can register an account** so I can join in.
  - Done when: I provide first name, surname, email, phone, password (all required), pick positions and team(s), and land signed in as a player, not XL-eligible, no admin.
- **As a player, I can sign in and out.**
  - Done when: correct email+password logs me in; sign-out asks to confirm.
- **As a player, I can edit my own details** so they stay current.
  - Done when: I can change name, phone, positions, preferred position; I cannot change my own role, eligibility, or email login.

### Fixtures & availability
- **As a player, I see only fixtures I'm allowed to** so XL games don't confuse the reserves.
  - Done when: a Community-only, non-eligible player never sees an XL fixture anywhere (list, calendar, who's-in, exports); enforced at the database, not just hidden in the UI.
- **As a player, I can set my availability** for a game.
  - Done when: I can set In / Maybe / Can't make it in **one tap from the next-game hero on the landing screen** (no drill-in) and **from a push notification's inline actions**; it saves with a confirmation; I can change it any time before kickoff. The fixture detail sheet is only needed for the fuller picture (venue, who's in, weather).
- **As a player, I can view who else is in** independently of setting my own.
  - Done when: I can open the who's-in list without touching my own availability, and see the squad split into available / maybe / out / no reply.
- **As a player, I can see where and when** a game is.
  - Done when: the fixture detail shows full venue, address, an Open-in-Maps link, what3words, kickoff, home/away; and within the forecast window, the weather.
- **As the gaffer, I can add, edit and remove fixtures.**
  - Done when: I can set team, opponent, venue, address, w3w, date, kickoff, home/away, type, season, and (for league games) league name; changes show for the squad straight away.
- **As the gaffer, I can see who's in across all upcoming games** at a glance.
  - Done when: the Who's In tab lists each upcoming fixture with in/maybe/out/no-reply counts and opens the full list.

### Results & match centre
- **As the gaffer, I can log a result** after a game.
  - Done when: I enter FT and HT score, add our goals (scorer + optional assist + optional minute, picked from squad or free-typed), and pick a man of the match; past fixtures without a result are flagged for me.
- **As anyone, I can view a finished game's match centre** so I can relive it.
  - Done when: I see FT/HT score, the goal timeline, MOTM, and the squad that played with goals/assists tallied.

### Club: stats & table
- **As anyone, I can see club stats** split the way the lads argue about them.
  - Done when: I can toggle Whole Club / XL 11s / Community; see a golden boot, leaderboards (scorers/assists/apps/MOTM) and a full squad table; every figure shows a combined total with the league/friendly split beneath.
- **As the gaffer, I keep the league table current** from the league's own source.
  - Done when: I can edit a per-team, per-season standings grid (P/W/D/L/GF/GA/Pts); it sorts by points then GD then GF, with our row highlighted.

### Players admin
- **As the gaffer, I manage the full squad.**
  - Done when: I can search, add a player manually, edit any field (incl. DOB, emergency contact), set positions/teams/XL flag/role, reset a password (never view it), and make a player inactive (dropping them off squad lists but keeping their past results).
- **As the gaffer, I can only create another admin myself**, and can't lock myself out.
  - Done when: role change to admin is admin-only; I cannot demote or deactivate my own account.

### Payments & export (MVP versions)
- **As the gaffer, I can mark who's paid** their subs for a game.
  - Done when: each available player has an admin-only paid/not-paid toggle per fixture.
- **As the gaffer, I can export a fixture's squad** to CSV.
  - Done when: I get a CSV with the fixture details as header line(s), then a row per player marked **in**: full name, preferred position, Paid (Yes/No).

### Notifications (MVP infra)
- **As a player, I get notified** about new games and reminders.
  - Done when: I can opt in to push; notifications fire reliably on Android (best-effort on iPhone, accepted limitation).

---

## Out of scope for MVP (so stories aren't written against them yet)
AI nudge drafting, match-report copy, squad-selection prompts; payment amounts/balances; calendar export; selected-XI capture; media-only role; league auto-calc. See HANDOVER §11.
