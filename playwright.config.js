import { defineConfig, devices } from '@playwright/test'

// Real-browser E2E on the engines this PWA actually runs on: it's phone-first,
// so the PRIMARY matrix is a real iPhone (WebKit / Mobile Safari) and a real
// Android (Chromium / Chrome). jsdom can't model rendering, viewport, scroll,
// history/popstate or async re-render timing — the gaps that let bugs through —
// and the two mobile engines differ enough (WebKit vs Blink) to be worth both.
//
// Auth flows read creds from env (E2E_ADMIN_*, E2E_PLAYER_*) and skip cleanly
// when absent, so the no-auth smoke layer always runs.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1, // the add-fixture / log-result flows mutate shared data — keep serial
  retries: 0,
  reporter: [['list']],
  timeout: 45_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: 'http://localhost:4173',
    reducedMotion: 'reduce', // stop infinite UI animations making elements "unstable"
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  // Phones first. Android (Chromium) grants notifications so the opt-in banner
  // stays out of the way; on iOS Safari the Notification API is absent in a tab,
  // so the banner never shows there anyway.
  projects: [
    { name: 'android', use: { ...devices['Pixel 7'], permissions: ['notifications'] } },
    { name: 'iphone',  use: { ...devices['iPhone 14'] } },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
