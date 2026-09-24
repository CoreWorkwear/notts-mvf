import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'

// Honours .eq() filters; `defer` parks every response in `pending` so a test
// can settle them out of order.
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
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ profile: { club_id: 'c1' } }) }))

import { useCompetitions } from './useCompetitions'

beforeEach(() => {
  store.pending.length = 0
  store.defer = false
  store.tables = {
    competitions: [
      { id: 'c-s1', name: 'League Cup', type: 'cup', season_id: 's1', squad_limit_enabled: false, squad_limit: null, active: true, sort_order: 0 },
      { id: 'c-s2', name: 'County Cup', type: 'cup', season_id: 's2', squad_limit_enabled: false, squad_limit: null, active: true, sort_order: 0 },
    ],
  }
})

describe('useCompetitions — latest request wins', () => {
  test('a slower, older season load does not overwrite the newer one', async () => {
    store.defer = true
    const { result, rerender } = renderHook(({ seasonId }) => useCompetitions(seasonId), { initialProps: { seasonId: 's1' } })
    await waitFor(() => expect(store.pending).toHaveLength(1))

    rerender({ seasonId: 's2' })
    await waitFor(() => expect(store.pending).toHaveLength(2))

    await act(async () => { store.pending[1].resolve() }) // s2 first
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.competitions.map((c) => c.id)).toEqual(['c-s2'])

    await act(async () => { store.pending[0].resolve() }) // stale s1, late
    expect(result.current.competitions.map((c) => c.id)).toEqual(['c-s2'])
    expect(result.current.loading).toBe(false)
  })
})
