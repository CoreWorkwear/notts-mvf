import { defineConfig, devices } from '@playwright/test'

// Real-browser E2E. jsdom unit tests can't model rendering, viewport, scroll,
// history/popstate or async re-render timing — the exact gaps that let bugs
// through — so these drive the PRODUCTION build in headless Chromium at a
// phone-sized viewport (the app is mobile-first).
//
// Auth flows read creds from env (E2E_ADMIN_EMAIL/PASSWORD, E2E_PLAYER_*) and
// skip cleanly when absent, so the no-auth smoke layer always runs.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 390, height: 844 }, // iPhone-ish, portrait
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce', // stop infinite UI animations making elements "unstable"
    permissions: ['notifications'], // permission != 'default' → the opt-in banner stays hidden, out of the way
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'mobile-chromium', use: { ...devices['Pixel 5'] } }],
  // Build, then serve dist/ — tests run against the real production bundle.
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
