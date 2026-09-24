import { describe, test, expect } from 'vitest'
import { groupErrors, kindsOf, fmtAgo, fmtCrumb, shortUA } from './diagnostics'

const rows = [
  { id: '1', created_at: '2026-09-24T10:00:00Z', kind: 'fetch', message: 'Load failed', url: '/fixtures', context: { build: '0.1.0+abc' } },
  { id: '2', created_at: '2026-09-24T11:00:00Z', kind: 'fetch', message: 'Load failed', url: '/results', context: { build: '0.1.0+def' } },
  { id: '3', created_at: '2026-09-24T09:00:00Z', kind: 'render', message: 'x is not a function', url: '/club', context: null },
  { id: '4', created_at: '2026-09-24T12:00:00Z', kind: 'fetch', message: 'Load failed', url: '/fixtures', context: {} },
]

describe('groupErrors', () => {
  test('collapses repeats of the same kind+message into one card with a count, urls and builds', () => {
    const g = groupErrors(rows)
    expect(g).toHaveLength(2)
    const lf = g.find((x) => x.message === 'Load failed')
    expect(lf.count).toBe(3)
    expect(lf.first).toBe('2026-09-24T10:00:00Z')
    expect(lf.last).toBe('2026-09-24T12:00:00Z')
    expect(lf.urls.sort()).toEqual(['/fixtures', '/results'])
    expect(lf.builds.sort()).toEqual(['0.1.0+abc', '0.1.0+def'])
    expect(lf.rows.map((r) => r.id)).toEqual(['4', '2', '1']) // newest first inside the group
  })

  test('orders groups by last seen, newest first', () => {
    expect(groupErrors(rows).map((g) => g.kind)).toEqual(['fetch', 'render'])
  })

  test('the same message under a different kind is a different problem', () => {
    const g = groupErrors([...rows, { id: '5', created_at: '2026-09-24T13:00:00Z', kind: 'write', message: 'Load failed', url: '/x', context: null }])
    expect(g.filter((x) => x.message === 'Load failed')).toHaveLength(2)
  })

  test('tolerates an empty or missing list', () => {
    expect(groupErrors([])).toEqual([])
    expect(groupErrors(null)).toEqual([])
  })
})

describe('kindsOf', () => {
  test('known kinds first in a stable order, then anything else alphabetically', () => {
    expect(kindsOf([{ kind: 'zzz' }, { kind: 'render' }, { kind: 'fetch' }, { kind: 'render' }, { kind: 'aaa' }])).toEqual(['render', 'fetch', 'aaa', 'zzz'])
  })
})

describe('fmtAgo', () => {
  const now = Date.parse('2026-09-24T12:00:00Z')
  test.each([
    ['2026-09-24T11:59:40Z', 'just now'],
    ['2026-09-24T11:30:00Z', '30 min ago'],
    ['2026-09-24T09:00:00Z', '3 h ago'],
    ['2026-09-20T12:00:00Z', '4 d ago'],
    ['2099-01-01T00:00:00Z', 'just now'],
  ])('%s → %s', (iso, out) => expect(fmtAgo(iso, now)).toBe(out))
})

describe('fmtCrumb', () => {
  test('one aligned line per crumb, data appended as JSON', () => {
    expect(fmtCrumb({ t: 1234, c: 'fetch', m: 'GET /rest/v1/x → 500', d: { ms: 900 } })).toBe('   1.2s  fetch  GET /rest/v1/x → 500 {"ms":900}')
    expect(fmtCrumb({ t: 0, c: 'nav', m: '/fixtures' })).toBe('   0.0s  nav    /fixtures')
  })
})

describe('shortUA', () => {
  test.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'iPhone · Safari'],
    ['Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36', 'Android · Chrome'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0', 'Windows · Edge'],
    ['', '—'],
    [null, '—'],
  ])('%s', (ua, out) => expect(shortUA(ua)).toBe(out))
})
