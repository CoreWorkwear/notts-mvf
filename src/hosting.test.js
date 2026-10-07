import { describe, test, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

// Cloudflare Pages decides how to route by which files exist under public/,
// not by anything in src/ — so nothing else in the suite can see it break.
// It did: a top-level public/404.html was added on 24 Sep 2026 and every deep
// link (/fixtures, /results, /you…) returned a 404 on live for thirteen days,
// invisible to anyone whose phone already ran the service worker (which
// serves the cached shell for every navigation).
//
// The two rules Pages applies, in this order, to a path with no file:
//   1. the NEAREST 404.html walking up the directory tree → served with a 404
//   2. no 404.html found → single-page fallback: /index.html with a 200
// So a 404.html at the top catches everything and switches rule 2 off, while
// one under assets/ catches only /assets/* — which is exactly the split we
// want: a missing hashed chunk must be a real 404 (public/_headers gives
// /assets/* a one-year immutable Cache-Control, and index.html answered there
// would be cached under that URL), and everything else is the app.
// Vitest runs from the project root (vite.config.js lives there).
const root = process.cwd() + '/'

describe('Cloudflare Pages routing', () => {
  test('there is no top-level 404.html — it would turn every deep link into a 404', () => {
    expect(existsSync(root + 'public/404.html')).toBe(false)
  })

  test('a missing file under /assets/ still gets a real 404 page', () => {
    expect(existsSync(root + 'public/assets/404.html')).toBe(true)
  })

  test('_redirects holds no rule Pages will not honour', () => {
    // `/* /index.html 200` is rejected as an infinite loop and a 404 status is
    // not a supported rewrite. Both sat in the file reading as if they worked.
    if (!existsSync(root + 'public/_redirects')) return
    const rules = readFileSync(root + 'public/_redirects', 'utf8')
      .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    expect(rules.filter((r) => /^\/\*\s/.test(r))).toEqual([])
    expect(rules.filter((r) => /\s404$/.test(r))).toEqual([])
  })

  test('the service worker does not precache the not-found page', () => {
    // globPatterns takes every .html in dist/; without this the 404 page would
    // ride along in the precache and be served as a 200 from the cache.
    const config = readFileSync(root + 'vite.config.js', 'utf8')
    expect(config).toMatch(/globIgnores:\s*\[[^\]]*assets\/404\.html/)
  })
})
