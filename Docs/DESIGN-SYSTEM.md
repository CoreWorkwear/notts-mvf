# Notts MvF — Design System & Style Guide (v2)

Companion to HANDOVER.md. The visual DNA of the app. **This doc leads on visuals and supersedes the prototype where they differ** — the prototype (`notts-mvf.html`) proves *layout, flows and behaviour*, but its specific fonts and some colours are first-draft and have been deliberately revised here after a 2026 design-craft review (see DESIGN-RESEARCH.md). Where this doc and the prototype disagree on a colour, a font, a texture or a motion detail, **this doc wins.**

**North star:** evolve seamlessly from the club's existing Instagram matchday graphics (the "NEXT UP" / "FULL TIME" poster language) into a product that feels curated and premium, not templated. Evolution, not revolution. The test for any screen: *screenshotted, it should sit comfortably next to the club's best Instagram post.*

**The one-line look:** dark-first, a clean near-black base with red (XL, first team) and green (Community, reserves) as the only two accents, bold editorial condensed display type, photographic poster heroes, subtle grain, restrained purposeful motion.

---

## 0. What we are deliberately avoiding (the "AI slop" tells)

Lock these out — they are why generic apps look generic:
- Default font stacks used because they *look* like the genre (Anton/Bebas everywhere, the Canva-sports-poster look). We pick faces that elevate, not imitate.
- Decorative gradients with no meaning; the "sickly yellow" hero gradient; glassmorphism sprayed everywhere.
- Templated bento grids and identical rounded cards in a grid.
- Flat, void-like dark backgrounds with no texture.
- Motion that flashes instead of guiding; spinners with no character; "No data" empty states.
- Invented decorative motifs that aren't from the club's real visual language.

Premium in 2026 = restraint, visible authorship, depth used for hierarchy, one strong point of view, and a few bespoke details done properly.

---

## 1. Colour

Strategy: **monochrome base + exactly two brand accents.** The base is a clean, near-black desaturated charcoal (a whisper of green so it's "ours", not a pure grey and NOT the old red-brown). Red and green are reserved for *meaning* — team identity, in/out, win/loss — never decoration. This editing-out is what reads premium and is the hardest thing for a template to fake.

```css
:root{
  /* BASE — near-black charcoal, faint cool/green undertone (not red-brown, not pure grey) */
  --ink:      #0c0f0d;   /* app background */
  --coal:     #14181 5;  /* (use #141815) raised surface / cards */
  --slate:    #1c211e;   /* higher surface / inputs / muted badge bg */
  --line:     #2a2f2b;   /* borders, dividers */
  --line-2:   #3a423c;   /* hover/active borders, grab handles */

  /* XL 11s — FIRST TEAM — red, the lead accent */
  --red:        #E11D2A;   /* primary brand red (cleaner, less pink than old #ff2e43) */
  --red-bright: #FF3340;   /* hover/active pop only */
  --red-dim:    rgba(225,29,42,0.14);
  --red-dim-2:  rgba(225,29,42,0.24);

  /* Community — RESERVES — green */
  --green:        #2FA84F;   /* primary brand green */
  --green-bright: #44D268;
  --green-dim:    rgba(47,168,79,0.14);
  --green-dim-2:  rgba(47,168,79,0.24);

  /* TEXT — warm off-white, never pure #fff for body */
  --bone:      #F2F0EC;   /* primary text */
  --bone-mute: #9aa39c;   /* secondary (neutral grey-green, not pinkish) */
  --bone-dim:  #5d655f;   /* tertiary / captions / placeholders */

  /* FUNCTIONAL accents (kept distinct from brand red/green so meaning is unambiguous) */
  --gold: #E8B53F;   /* golden boot, MOTM only */
  --amber:#F5A623;   /* "maybe", countdown warnings (NOT red — red is XL identity) */
  --amber-dim: rgba(245,166,35,0.14);
}
```

> Correction note for the build: `--coal` is `#141815`. (Typo guard — use that hex.)

**Win/loss & status colours:** win = `--green`, loss = `--red`, draw = `--bone-mute`. Note the deliberate overlap with team colours is acceptable *because* context disambiguates (a result card is clearly a result), but **never use red for form-validation errors** — errors use `--amber` or a plain bone text with an icon. Red means XL / win / "out", and that's it. (Monzo's lesson: a brand colour that also screams "error" confuses users.)

**Team gradients** (poster heroes, detail headers only — not everywhere):
- XL: `linear-gradient(150deg, #E11D2A 0%, #7d0f17 100%)`
- Community: `linear-gradient(150deg, #2FA84F 0%, #12401f 100%)`
Always with a dark wash on top (`linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55))`) so white display type stays legible over photo or colour.

**Contrast:** target WCAG AA on the dark base. `--bone` on `--ink` is fine; check `--bone-mute` on `--coal` for small text and bump to `--bone` if it fails.

---

## 2. Typography — the highest-leverage upgrade (locked after UK/European football research)

The prototype's Anton / DM Sans / DM Mono reads as a default 2026 pairing. A second research pass into what UK/European football brands *actually* use (Premier League's bespoke Premier Sans, Sky Sports Sans and TNT Sports by F37, Bundesliga's DFL Sans, the Ajax CoType family, BBC Reith) found the real register is **clean editorial grotesque/geometric sans with beautifully drawn numerals — NOT condensed "shouty" caps.** Condensed faces (Bebas, Oswald, Anton, Teko) are the *cliché* the elite brands deliberately avoid (Ajax's CD: most football brands "default to bold... loud, shouty" type — "we chose a different path... a distinctly editorial feel"). So the display face is editorial, not condensed.

**Four roles, all free and variable:**

```css
--font-display: 'Clash Display', sans-serif;  /* DISPLAY — Fontshare; editorial neo-grotesque */
--font-body:    'Hanken Grotesk', sans-serif; /* BODY / UI — Google */
--font-mono:    'Geist Mono', monospace;      /* DATA / scores / minutes / tables — Vercel */
--font-serif:   'Instrument Serif', serif;   /* EDITORIAL SERIF ACCENT — Google; large display flourishes */
```

> **Serif system (two roles, one live for MVP):** the two serifs do non-overlapping jobs and must never do each other's. **Instrument Serif** = large display flourishes only (pull-quotes, a "FULL TIME" flourish, the odd section title) — tall, elegant, high-contrast, sings big and weak small. **Fraunces** = running editorial text only (match-report paragraphs, longer intros) — warm, robust, comfortable at length. **MVP ships Instrument only** (the app's serif moments are currently flourishes, not running copy). **Fraunces is banked** — add it the moment a real match-report / editorial feature lands, governed by the rule above. Two serifs are only justified once both kinds of moment genuinely exist; until then, one.

- **Display — Clash Display (Bold)** (chosen) for hero opponent names, scorelines, page titles, the "NEXT UP / FULL TIME" lockups. Editorial neo-grotesque in the contemporary-European broadcast register (the Premier Sans / Ajax feel) — confident at large size *without* shouting. Set BIG, uppercase or title-case, tight tracking. Hero opponent name `clamp(40px, 13vw, 72px)`, line-height `.9`. Fontshare licence covers web/app embedding.
  - *Documented fallbacks, in the client's order:* **Bebas Neue** (#2 — used here as a deliberate, system-supported choice, not a lazy default), then **General Sans** (Fontshare, the quiet clean option). If a budget ever appears, license a British/European foundry face with football pedigree — **F37** (Judge / Britain Condensed), **CoType** (Aeonik), **Colophon** (Aperçu), or **Klim** (Founders Grotesk Condensed) — never a US-magazine condensed (Druk/Knockout).
- **Body — Hanken Grotesk** for all UI, body, forms, rows, buttons. The quiet premium grotesque. Weights 400–700. (Unchanged — the right register.)
- **Mono — Geist Mono** for kickoff times, dates, scorelines, stat figures, league-table numerics, eyebrow labels. Mono-for-data is exactly what the real brands do (Amazon Prime's PX Grotesk, TNT's monospaced tables).
- **Serif accent — Instrument Serif (the distinctive move, MVP)** used sparingly for *large flourishes*, not headlines or body: a pull-quote, a "FULL TIME" flourish, the odd section title. Tall, elegant, high-contrast — graceful at big sizes (use the italic for character), deliberately not a text face. This sans + editorial-serif pairing is the genuinely bespoke signal (TNT Sports, UEFA, EFL, Cambridge United all do it); almost no grassroots app does. Keep it rare — overuse kills it. **Fraunces is the banked partner for running editorial text** (match reports) when that feature arrives — see the serif-system note above.

**Numerals are a first-class concern.** Every elite football identity obsesses over distinct, legible numbers (scores, clocks, minutes, tables). Geist Mono is the workhorse for all of these; check digits read cleanly at small size in the league table and large in the broadcast-bug score.

**Eyebrow / kicker:** mono, 11px, `letter-spacing:.16em`, uppercase, `--bone-mute` ("NEXT UP", "FULL TIME", "VENUE", "WHO'S IN").

**The bespoke signal (free):** commit to *one* signature treatment used consistently — a coloured baseline rule under section kickers, plus the stacked two-word lockup ("NEXT / UP", "FULL / TIME") evolved from the club's Instagram (evolution, not a slavish copy). Body text never pure white — always `--bone`; white only over team-gradient/photo heroes.

---

## 3. Texture & depth (new — cheap premium signal)

- **Grain overlay.** A fixed, full-screen SVG `feTurbulence` fractal-noise layer at low opacity (~3–5%), `mix-blend-mode: soft-light`, `pointer-events:none`, above the background and below content. Stops the dark base reading "void-like" and kills gradient banding on the heroes. ~10 lines of CSS/SVG; or a tiny React component. This is one of the highest ratio-of-impact-to-effort moves available.
- **Depth for hierarchy, not decoration.** Borrow the *principle* of Apple's Liquid Glass (content leads; subtle translucency and soft shadow signal layering) but **not** the literal frosted-glass look — that already reads as a 2025 bandwagon. Sheets and the bottom nav use a blurred translucent base; cards use soft shadow + 1px border, not glass.

---

## 4. Shape & spacing

- **Radii:** inputs/buttons `12px`; cards/surfaces `14–16px`; poster heroes `18–20px`; bottom sheets `24px` top corners.
- **Borders:** `1px solid --line`; `1.5px` in team colour for selected/active controls.
- **Card spine:** a `6px` team-gradient bar down the left edge of strip rows (fixtures/results/players) — the at-a-glance team marker. Keep this; it's a clean, meaningful device.
- **Signature graphic device (replaces the concentric motif):** a single **diagonal cut / red-green split** used consistently — e.g. a slim diagonal edge where a hero photo meets the card, or a corner rule. This is the real football-identity move (cf. Ajax/Cambridge United modular systems) and it's *from the genre*, not invented decoration. **Retire the concentric-rings motif** from the prototype — it was invented, not from the club's graphics, and decorative-flourish patterns read templated.
- **Buttons:** `.btn-primary` = `--red` fill, white text, soft red glow shadow; `.btn-ghost` = surface bg, `--line` border, muted text. Press: `scale(.97)` + spring (see motion).
- **Inputs:** surface bg; focus → `--red` border + `0 0 0 3px --red-dim` ring; **16px** font-size (stops iOS zoom).
- **Chips:** pill, `--line` border; selected → team-colour dim fill + coloured text + border.

---

## 5. Motion & haptics (new — was underspecified)

- **Easing:** never linear. UI transitions 150–250ms with a custom ease (e.g. `cubic-bezier(.2,.8,.2,1)`); gentle follow-through/overshoot on arrival. Nothing that adds latency to a core task — no 300ms page-transition tax on checking availability.
- **Stagger:** list/squad items enter with a small staggered fade-up (20–40ms apart). Respect `prefers-reduced-motion` — drop to instant.
- **Hero depth:** an optional subtle pointer/tilt parallax on the poster hero (a few degrees, spring-eased) that *nods* to 3D without any 3D/video. Framer Motion. Behind `prefers-reduced-motion` and feature-gated for low-end Android.
- **Haptics (progressive enhancement only):** Web Vibration API (`navigator.vibrate`) for meaningful moments — marking yourself *in*, full-time confirmed, golden-boot reveal. Reliable on Android/Chrome, unreliable on iOS Safari — **never core to a flow**, always optional.

---

## 6. Signature moments (what makes it bespoke)

These are the cheap, high-impact details the template crowd skips. Build at least the first three.

1. **The next-game hero is an ACTION surface, not just a poster.** It tops the Fixtures screen (the landing for everyone) and carries the most-used control inline. *For a player:* the **in / maybe / out** control sits on the hero — one tap, saved-confirmation inline, no drill-in; if unanswered it's the visual focus. *For the gaffer:* the hero leads with **squad state** ("9 in · 3 maybe · 4 not replied"), tappable to who's-in / chase. Same component, persona-tuned. See UX-AND-IA.md.
2. **"Who's In" as a team-sheet, not an RSVP list.** The priority lean-forward screen — an XI building up plus bench, avatars/initials filling slots, a big animated count in display type ("9 IN"), a satisfying fill/stagger as players come in, optional haptic tick on tap-in, and a one-tap **chase the non-repliers** button. Pure React state + CSS.
3. **Broadcast-bug scoreline.** Scores in the mono/display face, large, crests flanking, on a dark grained card — a mini TV score bug. Animate the number on result entry.
4. **Poster hero, utility below.** Matchday / results / player-card screens open with a full-bleed photographic (or team-gradient) hero + stacked condensed headline + scoreline, then resolve into clean legible lists underneath. Expressive where it earns it; functional everywhere else.
5. **Golden Boot panel.** Gold gradient + crown + top scorer; the bragging-rights centrepiece (club-wide and per-team). Animate the reveal.
6. **Stats visualisation, done with restraint.** Horizontal bar rankings in accent colours with the value inline (top scorers, appearances); W-D-L form pills rather than dense tables; a single radar only for a season "player card", never radar-for-everything. Match the chart to the question; keep the data-ink ratio high.
7. **Branded loading + empty states (first-class).** A crest-based or condensed-countdown loader, not a generic spinner. **Every empty state is designed and in the club's voice** ("Nothing in the diary yet — season's coming"), never "No data". Modules empty early (stats, table) scale gracefully from zero — the first result logged should feel like an event. See UX-AND-IA.md §5.

---

## 7. Layout & mobile

- Mobile-first. Max content width `780px`, centred, `18px` side padding.
- **Sticky header** (`58px`, blurred translucent base) — crest, wordmark, season picker, sign-out. Respects `--safe-t`.
- **Fixed bottom tab nav** — blurred translucent, custom icon set at one stroke weight, mono labels, active in `--red`. Respects `--safe-b`; body `padding-bottom: calc(96px + safe-b)`.
- **Bottom sheets** for detail/edit — slide up on mobile, centre on desktop (`min-width:680px`), grab handle, `overscroll-behavior:contain`, hardware-back closes the sheet not the app.
- **Custom iconography:** one consistent set (e.g. Lucide normalised to a single stroke weight) — mixed default icons read as templated.

---

## 8. Identity & place (calibration)

The club is Nottingham / Nottinghamshire — a **place** identity, modern and regional. **Do NOT lean on Robin Hood / outlaw / medieval mythology** — it's a tired, contested local cliché (the symbol is divisive enough locally that a 2024 Nottingham rebrand dropping it made national design press, and a rebrand leaning *into* it would equally risk derision). The badge's hooded figure is incidental, not a brand pillar. Lean instead on: the red/green palette, a confident modern wordmark, and football-editorial styling in the Ajax / Cambridge United register. Authentic and current, not folkloric.

---

## 9. Voice (cross-ref GLOSSARY.md)

Casual, direct, matchday, British. "I'm in" / "Can't make it" / "Who's in" / "Nothing in the diary yet". Short, no corporate filler, no AI-sounding phrasing. British football vernacular always (fixtures not schedule, pitch not field — see GLOSSARY). Microcopy with a point of view is itself an anti-slop signal.

---

## 10. Implementation order

1. Lay down tokens (colour, type, spacing, motion, radius) as CSS variables / a tokens file FIRST — single source, applied everywhere (don't re-derive colours per-component the way the single-file prototype had to).
2. Load the three variable fonts (Archivo, Hanken Grotesk, Geist Mono).
3. Add the grain overlay and the base surfaces.
4. Build the poster-hero + utility layout; benchmark it against the club's best Instagram post before going further.
5. Layer the signature moments (Who's In team-sheet, broadcast-bug score, bar-chart stats), then motion/haptics, then custom icons and branded loaders.
6. Audit: motion easing & durations, contrast (AA on dark), `prefers-reduced-motion`, performance on mid-range Android (drop grain/tilt to static if needed).

**Font/colour divergence from the prototype is intentional** — Claude Code must take fonts and the palette from THIS doc, not by copying the prototype's Anton / red-brown `:root`. The prototype is the reference for *structure and behaviour*; this doc is the reference for *look*.
