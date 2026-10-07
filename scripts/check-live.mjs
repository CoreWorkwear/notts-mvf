#!/usr/bin/env node
// Post-deploy check against the DEPLOYED site.
//
// Cloudflare Pages builds and serves `master` on its own, so nothing in the
// test suite ever sees the thing players actually load. Twice that hid a live
// fault: every deep link returned a 404 for eleven days (a top-level 404.html
// had switched off the single-page fallback), and CI sat red for ten with
// deploys still going out. This asks the live site directly:
//
//   - is the build that is being served the commit that was just pushed?
//   - does the home page, and a deep link, come back as the app shell?
//   - is a missing hashed asset a real 404, and not cached as immutable?
//   - are the service worker, manifest and security headers there?
//
// usage: node scripts/check-live.mjs [--url https://…] [--sha <commit>] [--wait <seconds>]
//   --sha   expect this commit's build stamp; with --wait, poll until it is live
//   --wait  how long to wait for the deploy (default 0: check whatever is live)
// Exits 1 with a list of what failed. CI runs it on every push to master.

const arg = (name) => {
  const i = process.argv.indexOf('--' + name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const base = (arg('url') || process.env.LIVE_URL || 'https://notts-mvf.pages.dev').replace(/\/+$/, '')
const wantSha = (arg('sha') || '').slice(0, 7)
const waitSeconds = Number(arg('wait') || 0)

async function get(path) {
  const res = await fetch(base + path, { redirect: 'follow', headers: { 'cache-control': 'no-cache' } })
  return { status: res.status, headers: res.headers, body: await res.text() }
}

const isShell = (r) => r.status === 200 && /<div id="root">/.test(r.body)

// The build stamp is "<version>+<short sha>", baked into the entry chunk
// (vite.config.js → __APP_VERSION__).
async function servedSha() {
  const home = await get('/')
  const entry = home.body.match(/assets\/index-[\w-]+\.js/)?.[0]
  if (!entry) return null
  const js = await get('/' + entry)
  return js.body.match(/\d+\.\d+\.\d+\+([0-9a-f]{7})\b/)?.[1] ?? null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const failures = []
const fail = (msg) => { failures.push(msg); console.log('  FAIL  ' + msg) }
const pass = (msg) => console.log('  ok    ' + msg)

console.log(`Checking ${base}${wantSha ? ` for build ${wantSha}` : ''}`)

// 1. The right build is being served.
let sha = null
const deadline = Date.now() + waitSeconds * 1000
for (;;) {
  try { sha = await servedSha() } catch (e) { sha = null; console.log('  …     ' + (e?.message ?? e)) }
  if (!wantSha || sha === wantSha || Date.now() >= deadline) break
  console.log(`  …     serving ${sha ?? 'nothing readable'}, waiting for ${wantSha}`)
  await sleep(15_000)
}
if (!sha) fail('could not read a build stamp from the served bundle')
else if (wantSha && sha !== wantSha) fail(`live serves build ${sha}, expected ${wantSha} (the deploy has not landed, or failed)`)
else pass(`build stamp ${sha}`)

// 2. Home and deep links are the app shell. A deep link that 404s is invisible
//    to anyone with the service worker installed, so it has to be asked for cold.
for (const path of ['/', '/fixtures', '/results', '/you']) {
  const r = await get(path)
  if (isShell(r)) pass(`${path} → 200, app shell`)
  else fail(`${path} → ${r.status}${r.status === 200 ? ' but not the app shell' : ''}`)
}

// 3. A missing hashed asset is a real 404 and must not be cacheable for a year.
{
  const r = await get('/assets/__no-such-file__.js')
  const cc = r.headers.get('cache-control') || ''
  if (r.status !== 404) fail(`/assets/<missing> → ${r.status}, expected 404`)
  else if (/immutable/i.test(cc)) fail(`/assets/<missing> → 404 but cacheable as "${cc}"`)
  else pass('/assets/<missing> → 404, not immutable')
}

// 4. The pieces an installed app needs, and the headers that guard it.
for (const path of ['/sw.js', '/manifest.webmanifest']) {
  const r = await get(path)
  if (r.status === 200) pass(`${path} → 200`)
  else fail(`${path} → ${r.status}`)
}
{
  const r = await get('/')
  for (const h of ['content-security-policy', 'strict-transport-security', 'x-frame-options']) {
    if (r.headers.get(h)) pass(`header ${h}`)
    else fail(`header ${h} is missing on /`)
  }
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed on ${base}`)
  process.exit(1)
}
console.log('\nLive site looks right.')
