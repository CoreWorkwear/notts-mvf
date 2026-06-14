import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// PWA bits (manifest, service worker) land at build order step 13.
export default defineConfig({
  plugins: [react()],
  // Honour an assigned PORT (the preview harness sets one) else default to 5173.
  server: { port: Number(process.env.PORT) || 5173 },
})
