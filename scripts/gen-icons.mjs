// Rasterise public/icon.svg into the PWA PNG icons. Run: node scripts/gen-icons.mjs
import sharp from 'sharp'
import { readFileSync } from 'node:fs'

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url))
const render = (size, name) =>
  sharp(svg, { density: 512 }).resize(size, size).png().toFile(new URL(`../public/${name}`, import.meta.url).pathname.replace(/^\//, process.platform === 'win32' ? '' : '/'))

const targets = [
  [192, 'pwa-192x192.png'],
  [512, 'pwa-512x512.png'],
  [512, 'maskable-512.png'],
  [180, 'apple-touch-icon.png'],
]
for (const [size, name] of targets) {
  await render(size, name)
  console.log('wrote', name, size)
}
