import { describe, test, expect, beforeEach } from 'vitest'
import { breadcrumb, getBreadcrumbs, clearBreadcrumbs, MAX_BREADCRUMBS, sinceLoadMs } from './breadcrumbs'

beforeEach(() => clearBreadcrumbs())

describe('breadcrumbs — the trail attached to every logged error', () => {
  test('records category, message and elapsed time', () => {
    breadcrumb('nav', '/fixtures')
    const [c] = getBreadcrumbs()
    expect(c).toMatchObject({ c: 'nav', m: '/fixtures' })
    expect(typeof c.t).toBe('number')
    expect(c.t).toBeLessThanOrEqual(sinceLoadMs())
  })

  test('keeps optional small data and drops nothing else', () => {
    breadcrumb('fetch', 'GET /rest/v1/fixtures → 500', { ms: 1200 })
    expect(getBreadcrumbs()[0].d).toEqual({ ms: 1200 })
    breadcrumb('app', 'visible')
    expect(getBreadcrumbs()[1]).not.toHaveProperty('d')
  })

  test('is a ring buffer — never grows past MAX_BREADCRUMBS, oldest dropped first', () => {
    for (let i = 0; i < MAX_BREADCRUMBS + 5; i++) breadcrumb('nav', `/p${i}`)
    const trail = getBreadcrumbs()
    expect(trail).toHaveLength(MAX_BREADCRUMBS)
    expect(trail[0].m).toBe('/p5')
    expect(trail.at(-1).m).toBe(`/p${MAX_BREADCRUMBS + 4}`)
  })

  test('truncates runaway messages and tolerates junk input', () => {
    breadcrumb(undefined, 'x'.repeat(500))
    const [c] = getBreadcrumbs()
    expect(c.c).toBe('app')
    expect(c.m).toHaveLength(160)
    breadcrumb('a', null)
    expect(getBreadcrumbs()[1].m).toBe('')
  })

  test('getBreadcrumbs returns a copy — callers cannot mutate the trail', () => {
    breadcrumb('nav', '/a')
    getBreadcrumbs().push({ c: 'x', m: 'y', t: 0 })
    expect(getBreadcrumbs()).toHaveLength(1)
  })
})
