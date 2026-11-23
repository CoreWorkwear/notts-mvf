# Mobile screenshot matrix

## Hardware spec comparison at 384 × 854

The comparison captures the working React app on Chromium and WebKit, with the same fictional fixtures, club photograph and viewport on both grounds. The gallery pairs light and dark and links each image at its original size. The JSON records the production bundle, photo digest, viewport, ground and layout measurements.

Build and serve the production preview using the local fixture configuration below. From a second terminal, run the capture with a local copy of an existing club photograph.

```powershell
node scripts/mobile-grounds.mjs --url http://127.0.0.1:4187 --out "$env:TEMP/notts-mvf-384" --photo "C:/path/to/club-match.jpg"
```

Open **index.html** in the output directory. Each screen has its own subdirectory with native-resolution light and dark PNGs for both engines. Real-phone and staging tests are tracked separately on [NOT-12](https://linear.app/core-workwear/issue/NOT-12).

## Cross-device layout matrix


Run the production UI with a fictitious club season. Screens verify the expected route and wait for scenario content, fonts and the route entrance before capture. The sample captures three combinations per screen and engine. The full run captures all 48 per engine.

From the repository root in PowerShell, use a fresh output directory per candidate. Build into a temporary directory so the matrix can run alongside the normal checks.

```powershell
$env:VITE_SUPABASE_URL = 'https://matrix-local.supabase.co'
$env:VITE_SUPABASE_ANON_KEY = 'matrix-local-anon'
$matrixBuild = Join-Path $env:TEMP 'notts-mvf-matrix-build'
$matrixOutput = Join-Path $env:TEMP 'notts-mvf-matrix-evidence'
npm run build -- --outDir $matrixBuild
npm run preview -- --host 127.0.0.1 --port 4187 --strictPort --outDir $matrixBuild
```

In another terminal in the same repository, run the capture and open the gallery.

```powershell
$matrixOutput = Join-Path $env:TEMP 'notts-mvf-matrix-evidence'
node scripts/mobile-matrix.mjs --url http://127.0.0.1:4187 --out $matrixOutput --fail-overflow
Invoke-Item (Join-Path $matrixOutput 'index.html')
```

Install missing engine binaries with `npx playwright install chromium --only-shell` and `npx playwright install webkit`. Use Ctrl+C in the preview terminal after capture. The script uses the existing Supabase stub with fixture-specific answers. It accepts loopback sites, blocks service workers and refuses traffic to external origins.

| Viewport | Portrait width × height in CSS pixels |
|---|---|
| iPhone SE | 375 × 667 |
| iPhone 15/16 | 393 × 852 |
| iPhone Pro Max | 430 × 932 |
| Pixel 8 | 412 × 915 |
| Galaxy A-series | 360 × 800 |
| Fold cover, narrow configuration | 280 × 653 |
| Fold open | 653 × 841 |
| iPad mini | 744 × 1133 |

Each runs in portrait and landscape on Chromium and WebKit, with document root text set to 16, 24 and 32 CSS pixels. Safe-area tokens receive synthetic inset values, including side cut-outs and a home indicator in landscape. Device names identify test dimensions. Native assistive settings, the physical keyboard, hinge placement, display cut-outs and handset frame rate need device testing.

Each image has a corresponding entry in `measurements.json`. It includes the viewport, synthetic insets, document/dialog horizontal overflow, counts of controls measuring below 44 and 48 CSS pixels, save-button viewport and hit-test measurements, and controls extending outside the layout viewport. The latter include tabs and table cells that have a local scroll area. Inspect those cases in context. The measurements do not certify colour contrast, zoom behaviour, target size or access on a physical device.

Use `--sample` for the iPhone 15 portrait at 100%, iPhone SE landscape at 200%, and folded cover portrait at 200%. For a focused retry on the **same** build, use `--screen` and/or `--engine` repeatedly. For example, `--screen line-up --screen fixture-detail --engine webkit`. This updates the index and retains measurements for the other screens. Use a new output directory after rebuilding to keep earlier evidence separate.

To repeat a known subset after a targeted fix, pass `--cases path/to/affected.json`. Supply a JSON array of the affected relative image paths from the original measurements. Each new measurement identifies the Vite bundle that produced it. Successful screen/engine pairs also save their own measurements alongside the images while a long run is still in progress.
