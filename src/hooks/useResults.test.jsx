import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'

// PostgREST returns a one-to-one embed (fixtures→results) as an OBJECT, not an
// array (verified against the live API). The mock returns that real shape.
//
// Unlike src/test/supabaseMock.js this mock HONOURS .eq() filters (a row
// without the column passes) — the inactive-scorer regression below hinges on
// whether the hook filters profiles by active. `defer` parks every response
// in `pending` so a test can settle them out of order (latest-wins).
const store = vi.hoisted(() => ({ tables: {}, calls: [], pending: [], defer: false }))
vi.mock('../lib/supabase', () => {
  const make = (table) => {
    const call = { table, ops: [], filters: [] }
    store.calls.push(call)
    const rows = () => (store.tables[table] ?? []).filter((r) => call.filters.every(([c, v]) => r[c] === undefined || r[c] === v))
    const q = {
      then: (onF, onR) => (store.defer
        ? new Promise((res) => store.pending.push({ table, resolve: () => res({ data: rows(), error: null }) }))
        : Promise.resolve({ data: rows(), error: null })
      ).then(onF, onR),
    }
    ;['select', 'order', 'in', 'gte', 'lte'].forEach((m) => { q[m] = (...a) => { call.ops.push([m, ...a]); return q } })
    q.eq = (c, v) => { call.ops.push(['eq', c, v]); call.filters.push([c, v]); return q }
    return q
  }
  return { supabase: { from: make } }
})
vi.mock('../lib/logger', () => ({ logError: vi.fn() }))

import { useResults, resolveName } from './useResults'

const fixture = (over = {}) => ({
  id: 'fix-1', match_date: '2026-01-01', kickoff: '13:00:00', home_away: 'Home',
  fixture_type: 'League', league_name: null, venue: 'Derby Racecourse', team_id: 't1',
  team: { id: 't1', key: 'community', label: 'Community', colour: '#2FA84F' },
  opponent: { id: 'o1', name: 'Long Eaton', badge_url: null },
  result: { ht_us: 1, ht_them: 2, us: 2, them: 4, motm_profile_id: null, motm_name: null }, // OBJECT
  goals: [],
  ...over,
})

beforeEach(() => {
  store.calls.length = 0
  store.pending.length = 0
  store.defer = false
  store.tables = { fixtures: [fixture()], profiles: [] }
})

describe('useResults — one-to-one result embed', () => {
  test('a fixture WITH a result is counted as played, not "needs a result"', async () => {
    const { result } = renderHook(() => useResults('season-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.played).toHaveLength(1)
    expect(result.current.played[0].result).toMatchObject({ us: 2, them: 4 })
    expect(result.current.needsResult).toHaveLength(0)
  })
})

describe('useResults — never leaves the screen hanging', () => {
  test('a null seasonId resolves loading to false (no eternal "Fetching the results…")', async () => {
    const { result } = renderHook(() => useResults(null))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.played).toEqual([])
  })
})

// Removing a player is a SOFT delete (active=false) precisely so results history
// survives — but the name map was built from active profiles only, so a goal
// by a since-removed player rendered as "Unknown" in the Match Centre and
// re-saving that result dropped the goal (the form couldn't resolve the id).
describe('useResults — soft-deleted players still resolve on past results', () => {
  beforeEach(() => {
    store.tables.profiles = [
      { id: 'p1', first_name: 'Joe', last_name: 'Bloggs', active: true },
      { id: 'p2', first_name: 'Old', last_name: 'Timer', active: false },
    ]
    store.tables.fixtures = [fixture({ goals: [{ id: 'g1', minute: 12, scorer_profile_id: 'p2', scorer_name: null, assist_profile_id: null, assist_name: null }] })]
  })

  test('a goal by an inactive profile resolves to their name (squadById covers everyone)', async () => {
    const { result } = renderHook(() => useResults('season-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const played = result.current.played[0]
    expect(resolveName(played.squadById, played.goals[0].scorer_profile_id, played.goals[0].scorer_name)).toBe('Old Timer')
  })

  test('the squad picker stays active-only, while `everyone` also carries the inactive profile', async () => {
    const { result } = renderHook(() => useResults('season-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.squad.map((s) => s.id)).toEqual(['p1'])
    expect(result.current.everyone).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'p1', name: 'Joe Bloggs', first: 'Joe', active: true }),
      expect.objectContaining({ id: 'p2', name: 'Old Timer', first: 'Old', active: false }),
    ]))
  })
})

// Two games on the same day (a rearranged midweek fixture on a Sunday, say)
// were ordered arbitrarily — the later kickoff should list first.
describe('useResults — ordering', () => {
  test('fixtures are ordered by match_date DESC then kickoff DESC', async () => {
    const { result } = renderHook(() => useResults('season-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const fixturesCall = store.calls.find((c) => c.table === 'fixtures')
    const orders = fixturesCall.ops.filter(([op]) => op === 'order').map(([, ...args]) => args)
    expect(orders).toEqual([
      ['match_date', { ascending: false }],
      ['kickoff', { ascending: false }],
    ])
  })
})

// Switching season s1→s2 while s1's (slower) load is still in flight: the s1
// response landed last and overwrote s2's, so the Results screen showed last
// season's games under this season's picker until the next refetch.
describe('useResults — latest request wins', () => {
  test('a slower, older season load does not overwrite the newer one', async () => {
    store.defer = true
    store.tables.fixtures = [
      fixture({ id: 'f-s1', season_id: 's1' }),
      fixture({ id: 'f-s2', season_id: 's2' }),
    ]

    const { result, rerender } = renderHook(({ seasonId }) => useResults(seasonId), { initialProps: { seasonId: 's1' } })
    await waitFor(() => expect(store.pending).toHaveLength(2)) // fixtures + profiles for s1

    rerender({ seasonId: 's2' })
    await waitFor(() => expect(store.pending).toHaveLength(4)) // + fixtures + profiles for s2

    // The NEWER request settles first…
    await act(async () => { store.pending[2].resolve(); store.pending[3].resolve() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.played.map((f) => f.id)).toEqual(['f-s2'])

    // …then the stale s1 response arrives late. It must be ignored.
    await act(async () => { store.pending[0].resolve(); store.pending[1].resolve() })
    expect(result.current.played.map((f) => f.id)).toEqual(['f-s2'])
    expect(result.current.loading).toBe(false)
  })
})
