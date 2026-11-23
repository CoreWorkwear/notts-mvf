# Mobile tokens and component states

## Try the components

Run `npm run dev` and open `/Docs/components.html`. The inventory renders the app’s availability control, poster, fixture strip, scoreline, Sheet, Toast and Loader against a fictitious fixture. Switch themes, change an answer, choose **Delay**, **Fail** or **Offline**, and open **Edit fixture** to try the focus and Back behaviour. Changes stay in the preview. [Inventory source](components.jsx)

## Token layers

| Layer | Tokens | Use |
| --- | --- | --- |
| Primitives | `--kit-xl`, `--kit-community`, `--charcoal`, `--warm-white`, `--white` | Stable kit and base colours. Kit paint identifies the crest and team stripe. |
| Surfaces | `--surface`, `--surface-raised`, `--surface-input` | Page, panel and control backgrounds. |
| Text and boundaries | `--text`, `--text-secondary`, `--text-muted`, `--border`, `--border-strong`, `--focus` | Main text, supporting text, captions, divisions, input outlines and keyboard focus. |
| Team and match meaning | `--team-xl`, `--team-community`, `--status-in`, `--status-maybe`, `--status-out`, `--award` | Team labels, answers and awards. Preserve the accompanying label or control state. |
| Component paint | `--action-fill` / `--on-action`, `--hero-wash` / `--on-photo`, `--award-fill` / `--award-ink`, `--scrim` | Paired backgrounds and foregrounds for actions, photos, Golden Boot and overlays. |
| Existing names | `--ink`, `--coal`, `--slate`, `--bone*`, `--line*`, `--red-bright`, `--green-bright` | Aliases keep existing components on the same semantic palette. |

The document root resolves the device’s System, Light or Dark choice before first paint. Muted text on the ground measures 5.84∶1 by day and 7.77∶1 by night. The solid-pair tests cover normal text and keyboard indicators. Photographic surfaces also require rendered inspection. [Token definitions](../src/styles/tokens.css) · [Contrast checks](../src/styles/mobile.test.js)

## Rhythm and type

| Spacing token suffix | CSS pixels | Typical use |
| --- | --- | --- |
| `--space-1`, `-2` | 4, 8 | Inside a group and between label and value |
| `-3`, `-4` | 12, 16 | Panel padding and page gutter |
| `-5`, `-6`, `-8` | 20, 24, 32 | Section separation |
| `-10`, `-12`, `-14`, `-16`, `-24` | 40, 48, 56, 64, 96 | Larger separations and reserved space |

`--gutter`, `--target` and `--header-min` use the 16, 48 and 56px steps. All four device insets come from `safe-area-inset-*`. The bottom nav reserves its rendered height below the page. When enlarged tab labels outgrow the row, the rail scrolls horizontally inside the safe edges. Padding, margins and gaps use the spatial scale. Strokes, icon artwork, media dimensions and pitch markings have independent geometry.

| Type token suffix | rem | Default CSS pixels | Use |
| --- | --- | --- | --- |
| `--type-xs`, `-caption` | .75 | 12 | Brief labels, metadata |
| `-sm`, `-body` | .875, 1 | 14, 16 | Rows, body copy, actions, inputs |
| `-lead`, `-lg`, `-title` | 1.125, 1.25, 1.375 | 18, 20, 22 | Match details and sheet headings |
| `-display`, `-score`, `-poster`, `-scoreboard` | 1.625, 1.875, 1.875, 1.875 | 26, 30 | Page titles, opponents and scores |

Instrument Sans carries words. JetBrains Mono carries scores, dates, times and codes with tabular figures. Relative type follows the reader’s root size. The 48px target is a minimum and a wrapped control grows. [Font definitions](../src/styles/fonts.css)

## Component states

| Component | Default, selected and pressed | Disabled, locked, loading, error and offline |
| --- | --- | --- |
| Availability | Three named buttons with pressed semantics. Compact labels in strips. Confirmation follows a successful write. | A pending write disables the row. The relevant account, squad, kickoff or postponement reason replaces locked buttons. A failed write leaves the previous answer intact. |
| Team chips and position pills | Entire label is tappable. Selected controls expose their pressed state and team chips use the appropriate accent. | Read-only chips are text. Saving and failure belong to the form containing the choices. |
| Fixture strip and poster | Team and date identify each match. The hero leads with the player’s next answerable game or the manager’s squad state. Two to four upcoming matches form a scroll-snapping rail. Longer diaries run vertically. | Locked fixtures retain their details. Initial load, failed refresh and offline data belong to the fixture list. |
| Scoreline and avatar | Two named sides around the score. Photos and initials reserve their own space. | An absent photo uses initials. These display elements have no independent write state. |
| Button and input | Keyboard focus ring, touch feedback, selected values, labels and invalid state. | Busy controls prevent duplicate actions. Keep entered values and show the reason when saving fails. |
| Sheet | Accessible name from the heading, contained tab sequence, Back or Escape to close, focus returned to the opener. A designated answer can take initial focus. | The visual viewport positions the sheet above the keyboard. Keep weekly editor actions within the sheet scrollport. |
| Toast | Errors announce as alerts, confirmations as status. Dismissal works with a keyboard or touch. | Error text describes the outcome and recovery. The calling action owns retries. |
| Skeleton and empty state | A loading label is announced and skeleton bars reveal after a brief delay. A successful empty list explains what will appear. | Preserve prior data after a failed refresh. An empty failed load offers recovery. Offline fixtures identify their last-known state. |

Poster motion moves the artwork independently of the controls. Reduced motion disables it. Header and navigation blur fall back to a solid surface for reduced transparency or forced colours. Emulator samples and physical handset measurements are recorded separately. [Matrix method](MOBILE-MATRIX.md)
