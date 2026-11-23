# Nottinghamshire MvF design system

Fixtures, results, player details and manager tools use the approved Hardware spec. The public squad names are **1st Team** and **Community**. Use **Nottingham** where it is the competitive fixture name. The crests and match photography identify the club.

## Colour and appearance

The kit colours are red #E11D2A and green #2FA84F. The UI crimson comes from club match graphics and the emerald from the Community shirt. A new device follows the system. An explicit Light or Dark choice persists until the member selects System. The ground resolves before first paint. [Approved palette and photographic references](mobile-ux/hardware-spec/PLAN.md)

| Role | Light | Dark |
| --- | --- | --- |
| Ground | #F2F0E9 | #141A12 |
| Card | #FAF9F5 | #1C2419 |
| Text / muted | #202820 / #555F54 | #ECEADF / #A9AE9B |
| 1st Team | #C51C36 | #F38A99 |
| Community / primary action | #127650 | #64C7A3 |
| Primary action ink | #FAF9F5 | #102516 |
| Pending | #755511 | #E7C578 |

Use a semantic token for every component colour. Live, pending and failed states use a round indicator and a word. A selected availability button also carries a tick and a programmatic pressed state. Use the strong line for control boundaries and the faint rule for grouping. Small text needs 4.5∶1 contrast and essential control boundaries need 3∶1. [Production tokens](../src/styles/tokens.css)

## Type and layout

Use bundled Instrument Sans 400–700 for words and JetBrains Mono 500/700 with tabular figures for scores, kick-offs, dates, league places and codes. The default type sizes are 12, 14, 16, 18, 20, 22, 26 and 30px. Use root-relative type so members can enlarge text.

Use an 8px rhythm with a 4px fine step. The mobile gutter is 16px. Controls are at least 48px and bars start at 56px. Preserve all four safe-area insets and let labels and bars grow. Fields have 10px corners, cards 14px, the match poster 20px and sheets 24px. The sticky header and floating tab bar use translucent surfaces with an opaque fallback.

## Matchday

Show the saved photograph on Fixtures, fixture detail, Results and match centre. With no pin, the fixture ID selects a stable image from the existing club pool. An empty pool uses the team gradient. Changing ground preserves the photograph. Use a local scrim and caption backing over the photo and give availability and squad actions their own readable surface.

## Controls, motion and copy

The selected availability answer moves within a single track. The answer and squad totals update on tap. Show “Saving…” until the write completes and restore the previous answer if it fails. Club navigation and full-size availability controls share the snappy spring in `src/lib/motion.js`. The drawer uses a heavier spring. Drag its grip to dismiss or activate it with the keyboard. Respect reduced motion and keep the sheet mounted across changes to its open state so Back, focus restoration and keyboard-safe actions work.

Use British football terms, including fixtures, results, pitch, kit and line-up. Use Manager and players. Write labels, values, verbs and state words. Preserve the information members need to recover from a failure or grant a permission. [Component behaviour and measurements](MOBILE-TOKENS.md)
