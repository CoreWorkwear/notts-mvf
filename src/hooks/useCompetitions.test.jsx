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

describe('useCompetitions — loaded', () => {
  test('false until the first load completes, true after, even with none set up', async () => {
    store.tables.competitions = []
    const { result } = renderHook(() => useCompetitions('s1'))
    expect(result.current.loaded).toBe(false)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.loaded).toBe(true)
  })
})

describe('useCompetitions — loaded is per season', () => {
  test('switching season: not loaded again until that season\u2019s own load completes', async () => {
    const { result, rerender } = renderHook(({ s }) => useCompetitions(s), { initialProps: { s: 's1' } })
    await waitFor(() => expect(result.current.loaded).toBe(true))

    store.defer = true
    rerender({ s: 's2' })
    expect(result.current.loaded).toBe(false)
    await waitFor(() => expect(store.pending).toHaveLength(1)) // the request is out
    expect(result.current.loaded).toBe(false)
    await act(async () => { store.pending.splice(0).forEach((p) => p.resolve()) })
    await waitFor(() => expect(result.current.loaded).toBe(true))
  })
})
