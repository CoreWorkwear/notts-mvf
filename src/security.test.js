import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

// public/_headers is the only place the app's security headers exist — there's
// no server to assert them from, and Cloudflare Pages serves the file as-is.
// These tests are that file's regression net: a CSP is easy to write once and
// then silently break with an unrelated change (a new external origin, an edit
// to the inline theme script), and the failure mode is a blank screen in
// production that nothing in the suite would otherwise catch.
// Vitest runs from the project root (vite.config.js lives there).
const root = process.cwd() + '/'
const headers = readFileSync(root + 'public/_headers', 'utf8')
const indexHtml = readFileSync(root + 'index.html', 'utf8')

// The single `/*` block, as a "Name: value" map.
const globalHeaders = Object.fromEntries(
  headers
    .split(/^\/\*\s*$/m)[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf(':')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
)

const csp = Object.fromEntries(
  globalHeaders['Content-Security-Policy']
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const [name, ...values] = d.split(/\s+/)
      return [name, values]
    })
)

describe('shipped security headers', () => {
  test('the app is HTTPS-only, never framed, never sniffed, and leaks no referrer', () => {
    expect(globalHeaders['Strict-Transport-Security']).toMatch(/max-age=31536000/)
    expect(globalHeaders['X-Frame-Options']).toBe('DENY')
    expect(globalHeaders['X-Content-Type-Options']).toBe('nosniff')
    expect(globalHeaders['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(globalHeaders['Permissions-Policy']).toMatch(/geolocation=\(\)/)
  })

  test('a CSP is present and shuts the four directives that have no legitimate use here', () => {
    expect(globalHeaders['Content-Security-Policy']).toBeTruthy()
    expect(csp['default-src']).toEqual(["'self'"])
    expect(csp['object-src']).toEqual(["'none'"])
    expect(csp['base-uri']).toEqual(["'none'"])
    expect(csp['frame-ancestors']).toEqual(["'none'"])
    expect(csp['form-action']).toEqual(["'self'"])
  })

  test('script-src allows no inline script beyond the one hash, and no eval', () => {
    expect(csp['script-src']).not.toContain("'unsafe-inline'")
    expect(csp['script-src']).not.toContain("'unsafe-eval'")
    expect(csp['script-src'].filter((s) => s.startsWith("'sha256-"))).toHaveLength(1)
  })

  // The regression this file exists for: edit the theme script in index.html
  // and the CSP hash stops matching, so the browser blocks it and every cold
  // load flashes the wrong theme. Nothing else would notice.
  test("the script-src hash is the hash of index.html's inline theme script", () => {
    const inline = indexHtml.match(/<script>([\s\S]*?)<\/script>/)
    expect(inline, 'the inline theme script is gone — drop the hash from the CSP too').toBeTruthy()
    const expected = "'sha256-" + createHash('sha256').update(inline[1], 'utf8').digest('base64') + "'"
    expect(csp['script-src']).toContain(expected)
  })

  test('images may only come from the app itself or the project media bucket', () => {
    // Mirrors the DB constraints on every rendered *_url column (0035 F6, 0037 D).
    expect(csp['img-src'].sort()).toEqual(["'self'", 'blob:', 'data:', 'https://*.supabase.co'].sort())
  })

  test('connect-src names every origin the app actually calls, and nothing else', () => {
    // src/lib/supabase.js, weather.js, geocode.js. Adding a fetch to a new
    // origin without adding it here fails at runtime — so fail here first.
    expect(csp['connect-src'].sort()).toEqual([
      "'self'",
      'https://*.supabase.co',
      'https://api.open-meteo.com',
      'https://api.postcodes.io',
      'https://geocoding-api.open-meteo.com',
      'wss://*.supabase.co',
    ].sort())
  })

  test('the only framed origin is the OpenStreetMap venue embed', () => {
    expect(csp['frame-src']).toEqual(['https://www.openstreetmap.org'])
  })
})
