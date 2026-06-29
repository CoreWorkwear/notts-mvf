// Generate the PWA PNG icons. Source = a crest image URL/path if given,
// else public/icon.svg.  Usage:
//   node scripts/gen-icons.mjs                       # from public/icon.svg
//   node scripts/gen-icons.mjs <crest-url-or-path>   # from the club crest
// The crest is centred (with a maskable safe-zone) on the charcoal theme bg.
import sharp from 'sharp'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const src = process.argv[2]
const BG = { r: 12, g: 15, b: 13, alpha: 1 } // #0c0f0d (theme background)

async function source() {
  if (src && /^https?:/.test(src)) return Buffer.from(await (await fetch(src)).arrayBuffer())
  if (src && existsSync(src)) return readFileSync(src) // a path relative to cwd / absolute
  return readFileSync(join(pub, src || 'icon.svg'))
}

async function make(size, name, maskable = false) {
  const buf = await source()
  const padFrac = maskable ? 0.16 : 0.08 // keep the crest inside the safe zone
  const inner = Math.round(size * (1 - padFrac * 2))
  const fg = await sharp(buf, { density: 512 })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: fg, gravity: 'center' }])
    .png().toFile(join(pub, name))
  console.log('wrote', name)
}

await make(192, 'pwa-192x192.png')
await make(512, 'pwa-512x512.png')
await make(512, 'maskable-512.png', true)
await make(180, 'apple-touch-icon.png')
await make(48, 'favicon.png') // browser tab
