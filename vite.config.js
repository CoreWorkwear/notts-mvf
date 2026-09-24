/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// "<pkg version>+<short sha>" baked into the bundle as __APP_VERSION__. Every
// client_errors row carries it (src/lib/logger.js), so Diagnostics can tell a
// crash on a stale cached build from one on the current deploy. Cloudflare
// Pages exposes the sha as CF_PAGES_COMMIT_SHA; locally we ask git.
function buildStamp() {
  let version = '0.0.0'
  try { version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version ?? version } catch { /* keep */ }
  let sha = (process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || '').slice(0, 7)
  if (!sha) {
    try { sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { sha = 'local' }
  }
  return `${version}+${sha}`
}

// Installable PWA on Cloudflare Pages (HANDOVER §8.13 / BUILD-LIST C): manifest,
// crest icons, service worker (offline app shell), auto-update.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt' (not autoUpdate): a new build installs in the background but is
      // NOT force-applied. autoUpdate reloaded the page mid-launch on the first
      // open after every deploy — the cold-start "hang". We surface a quiet
      // "Refresh" prompt instead (main.jsx + UpdatePrompt), so cold open serves
      // the cached shell instantly.
      registerType: 'prompt',
      injectRegister: false, // we register manually in main.jsx to poll for updates
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'favicon.png'],
      manifest: {
        name: 'Nottinghamshire MvF',
        short_name: 'Notts MvF',
        description: 'Fixtures, availability, results and stats for Nottinghamshire MvF.',
        theme_color: '#0c0f0d',
        background_color: '#0c0f0d',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        // Supabase API/auth is always network — never serve it from the SW cache.
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//],
        cleanupOutdatedCaches: true,
        // Push a new deploy out immediately: the fresh SW skips the "waiting"
        // state and claims open tabs, so users get the latest build on next load
        // (with registerType:'autoUpdate' that triggers an auto-reload) — no
        // manual cache-clearing after a deploy.
        skipWaiting: true,
        clientsClaim: true,
        // Web-push handlers live in a plain script imported into the SW.
        importScripts: ['/push-sw.js'],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Vendor libraries in their own chunks: a deploy that only touches app
        // code no longer invalidates ~500 kB of unchanged vendor bytes in the
        // PWA precache, and the browser parses them in parallel.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          motion: ['framer-motion'],
        },
      },
    },
  },
  define: { __APP_VERSION__: JSON.stringify(buildStamp()) },
  server: { port: Number(process.env.PORT) || 5173 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    css: false,
    // Keep vitest to src unit/component tests — the e2e/*.spec.js Playwright
    // tests run under a separate runner (npm run test:e2e).
    // The Edge Functions' pure decision logic lives in plain-JS modules under
    // supabase/functions/_shared so it can be tested here without Deno.
    include: ['src/**/*.test.{js,jsx}', 'supabase/functions/_shared/**/*.test.js'],
    // Coverage is a regression floor, not a target: the thresholds sit just
    // under where the suite is today so a change that drops coverage fails
    // loudly (npm run test:coverage). Raise them as coverage grows.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/**/*.test.{js,jsx}', 'src/test/**', 'src/main.jsx'],
      reporter: ['text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // Measured 2026-09-24: lines 78.8 / statements 78.8 / functions 60.8 /
      // branches 77.4 — the floor sits a couple of points under each.
      thresholds: { lines: 76, statements: 76, functions: 58, branches: 74 },
    },
  },
})
