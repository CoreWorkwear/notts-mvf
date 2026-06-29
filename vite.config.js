/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

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
  server: { port: Number(process.env.PORT) || 5173 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    css: false,
    // Keep vitest to src unit/component tests — the e2e/*.spec.js Playwright
    // tests run under a separate runner (npm run test:e2e).
    include: ['src/**/*.test.{js,jsx}'],
  },
})
