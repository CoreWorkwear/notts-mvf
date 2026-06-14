# Notts MvF — Design Research (condensed reference)

Background research behind DESIGN-SYSTEM.md, captured so the build team can see the *why*. Two passes were run.

## Pass 1 — Premium app craft & avoiding "AI slop" (2026)
- **Direct competitors (Spond, Heja, Pitchero, TeamStats) are functional but undesigned** — the opportunity is that none has a point of view.
- **Premium feel lives in the fan/match tier:** FotMob (content-first minimalism, one accent), Apple Sports (remixes stock components, contextual team-colour gradients), Sofascore (deep data, risks overwhelming). Lesson: content dominates, chrome recedes, reveal one layer at a time.
- **The model for bold-graphics-into-product:** DixonBaxi's Premier League / Prime Video work ("every interaction is the brand", but the product UI is *restrained* with a monospace for stats), Smörgåsbord's AFC Ajax rebrand (rejected "loud, shouty" sports type for an "editorial feel"), Gretel/The Athletic (custom inline type as brand).
- **"AI slop" tells to avoid:** default gradients (esp. sickly yellow), glassmorphism everywhere, thoughtless bento grids, void-like flat dark backgrounds, characterless minimalism, motion that flashes not guides, "No data" empty states.
- **What reads premium in 2026:** visible craft/authorship, dark-first, subtle translucency *for hierarchy* (borrow Liquid Glass principles not the literal frosted look — already a bandwagon), expressive editorial type, grain/noise texture, purposeful motion, microcopy with a point of view.
- **Signature, buildable-in-React ideas:** the "Who's In" team-sheet, broadcast-bug scoreline, restrained bar-chart stats (high data-ink ratio, radar only for player cards), SVG grain overlay (feTurbulence, ~10 lines), subtle hero tilt (Framer Motion, nods to 3D without 3D/video), haptics via Web Vibration API (progressive enhancement, unreliable on iOS), custom icon set at one stroke weight.
- **Nottingham identity:** keep it modern-regional; avoid Robin Hood (contested local cliché).

## Pass 2 — Sounding British/European, not American (typography)
- **The real register of UK/European football is clean editorial grotesque/geometric sans with great numerals — NOT condensed "shouty" caps.** Condensed faces (Bebas, Oswald, Anton, Teko) are the cliché elite brands avoid.
- **What the actual brands use (all bespoke, not licensable — emulate the *style*):** Premier League → Premier Sans (Monotype/DesignStudio, geometric, distinct numerals); UEFA Champions League → Champions / Champions Display (Fontsmith / Branding with Type) + serif wordmark; Sky Sports → Sky Sports Sans (F37, humanist, broadcast numerals); TNT Sports → Sans + Serif pairing (F37, editorial serif accent); BBC → Reith (Dalton Maag, humanist); ITV → Reem (Fontsmith); Amazon Prime → PX Grotesk mono for stats; Bundesliga → DFL Sans (Rosetta); LaLiga → bespoke (Arillatype); EFL → EFL 1888 semi-serif; Ajax → 15-cut CoType family (the on-point reference).
- **Dominant foundries:** F37 (British — Sky, TNT, Chelsea, Spurs), CoType (British — Ajax), Fontsmith (UEFA, ITV), Monotype (PL), Rosetta (Bundesliga).
- **Free display picks that read British/European-editorial:** Clash Display (chosen), Archivo, Libre Franklin, General Sans. **Numerals matter most** — every elite identity obsesses over them.
- **Paid "grown-up" upgrades (British/European pedigree, if budget appears):** F37 Judge / Britain Condensed, CoType Aeonik, Colophon Aperçu, Klim Founders Grotesk Condensed, Grilli Type GT Walsheim.
- **Avoid as American-coded:** Druk/Knockout (US-magazine), college/varsity block, extreme wide weights (NFL/NBA), Gotham/Interstate as a "football" signal (both were actively *dropped* by European brands), and over-reliance on Bebas/Oswald/Teko as the brand voice.

## Net decisions (reflected in DESIGN-SYSTEM.md)
- Display: **Clash Display Bold** (fallbacks Bebas Neue, then General Sans).
- Body: **Hanken Grotesk**. Data: **Geist Mono**. Serif accent: **Instrument Serif** (large flourishes, MVP), with **Fraunces** banked for running match-report text when that feature lands — two non-overlapping roles, one live for now.
- Palette: charcoal base + red/green accents only. Grain overlay. Diagonal-split device (not the invented concentric motif). Editorial, restrained, numerals-first, British/European register.
