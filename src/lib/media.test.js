import { describe, test, expect } from 'vitest'
import { hashString, pickHeroImage, heroBackground } from './media'

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
