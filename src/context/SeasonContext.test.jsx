import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'

// Every seasons read is parked in `pending` so a test can settle it after the
// auth state has moved on.
const store = vi.hoisted(() => ({ rows: [], pending: [] }))
const auth = vi.hoisted(() => ({ isAuthed: true, holding: null, loading: false }))
vi.mock('../lib/supabase', () => {
  const make = () => {
    const q = {
      then: (onF, onR) => new Promise((res) => store.pending.push({ resolve: () => res({ data: store.rows, error: null }) })).then(onF, onR),
    }
    ;['select', 'order', 'eq'].forEach((m) => { q[m] = () => q })
    return q
  }
  return { supabase: { from: make } }
})
vi.mock('./AuthContext', () => ({ useAuth: () => ({ isAuthed: auth.isAuthed, holding: auth.holding, loading: auth.loading }) }))
vi.mock('../lib/logger', () => ({ logError: vi.fn() }))

import { SeasonProvider, useSeason } from './SeasonContext'

beforeEach(() => {
  store.pending.length = 0
  store.rows = [{ id: 's1', label: '2025/26', is_current: true }]
  auth.isAuthed = true
  auth.holding = null
  auth.loading = false
})

describe('SeasonProvider — held accounts', () => {
  test.each(['pending', 'inactive'])('a %s account fires no seasons fetch and settles quietly', async (h) => {
    auth.holding = h
    const { result } = renderHook(() => useSeason(), { wrapper: SeasonProvider })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(store.pending).toHaveLength(0)
    expect(result.current.seasonId).toBeNull()
    expect(result.current.error).toBeNull()
  })

  // Found in a real browser (e2e/holding.spec.js): while the profile is still
  // loading, holding is null for everyone, so a pending account fired one
  // seasons fetch before the holding screen took over. Wait until auth knows.
  test('no seasons fetch while auth is still loading, then one once it lands', async () => {
    auth.loading = true
    const { rerender } = renderHook(() => useSeason(), { wrapper: SeasonProvider })
    await new Promise((r) => setTimeout(r, 20))
    expect(store.pending).toHaveLength(0)
    auth.loading = false
    rerender()
    await waitFor(() => expect(store.pending).toHaveLength(1))
  })
})

describe('SeasonProvider', () => {
  test('seeds seasonId from the current season once signed in', async () => {
    const { result } = renderHook(() => useSeason(), { wrapper: SeasonProvider })
    await waitFor(() => expect(store.pending).toHaveLength(1))
    await act(async () => { store.pending[0].resolve() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.seasonId).toBe('s1')
  })

  // An in-flight seasons fetch survived sign-out (`active` only gated loading),
  // so it re-seeded seasonId after the provider had been cleared — a signed-out
  // app still carried a season, and the next sign-in inherited it.
  test('a seasons fetch that lands after sign-out does not re-seed the season', async () => {
    const { result, rerender } = renderHook(() => useSeason(), { wrapper: SeasonProvider })
    await waitFor(() => expect(store.pending).toHaveLength(1))

    auth.isAuthed = false
    rerender()
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => { store.pending[0].resolve() }) // the stale fetch finally lands
    expect(result.current.seasonId).toBeNull()
    expect(result.current.seasons).toEqual([])
  })
})
