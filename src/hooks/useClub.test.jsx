import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'

// Honours .eq() filters (a row without the column passes); `defer` parks every
// response in `pending` so a test can settle them out of order.
const store = vi.hoisted(() => ({ tables: {}, pending: [], defer: false }))
vi.mock('../lib/supabase', () => {
  const make = (table) => {
    const filters = []
    const rows = () => (store.tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === undefined || r[c] === v))
    const q = {
      then: (onF, onR) => (store.defer
        ? new Promise((res) => store.pending.push({ table, resolve: () => res({ data: rows(), error: null }) }))
        : Promise.resolve({ data: rows(), error: null })
      ).then(onF, onR),
    }
    ;['select', 'order', 'in'].forEach((m) => { q[m] = () => q })
    q.eq = (c, v) => { filters.push([c, v]); return q }
    return q
  }
  return { supabase: { from: make } }
})
vi.mock('../lib/logger', () => ({ logError: vi.fn() }))

import { useClub } from './useClub'

beforeEach(() => {
  store.pending.length = 0
  store.defer = false
  store.tables = {
    league_tables: [
      { id: 'lt1', season_id: 's1', team_key: 'xl', rows: [] },
      { id: 'lt2', season_id: 's2', team_key: 'xl', rows: [] },
    ],
    teams: [{ id: 't1', key: 'xl', label: 'First Team', match_name: 'Notts', colour: '#E11D2A', is_first_team: true, league_name: null }],
    fixtures: [],
    lineups: [],
    profiles: [],
  }
})

// Switching season s1→s2 while s1's (slower) load is still in flight: the s1
// response landed last, so the Club tab showed last season's table and stats
// under this season's picker.
describe('useClub — latest request wins', () => {
  test('a slower, older season load does not overwrite the newer one', async () => {
    store.defer = true
    const { result, rerender } = renderHook(({ seasonId }) => useClub(seasonId), { initialProps: { seasonId: 's1' } })
    await waitFor(() => expect(store.pending).toHaveLength(5)) // 5 queries per load

    rerender({ seasonId: 's2' })
    await waitFor(() => expect(store.pending).toHaveLength(10))

    await act(async () => { store.pending.slice(5).forEach((p) => p.resolve()) }) // s2 first
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.table.map((t) => t.season_id)).toEqual(['s2'])

    await act(async () => { store.pending.slice(0, 5).forEach((p) => p.resolve()) }) // stale s1, late
    expect(result.current.table.map((t) => t.season_id)).toEqual(['s2'])
    expect(result.current.loading).toBe(false)
  })
})
