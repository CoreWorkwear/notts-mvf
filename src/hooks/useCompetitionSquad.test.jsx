import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'

// Honours .eq() filters on reads; writes resolve { error: store.writeError }.
// `defer` parks every response in `pending` so a test can settle them out of order.
const store = vi.hoisted(() => ({ tables: {}, pending: [], defer: false, writeError: null }))
const logError = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase', () => {
  const make = (table) => {
    const filters = []
    let write = false
    const rows = () => (store.tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === undefined || r[c] === v))
    const settle = () => (write ? { data: null, error: store.writeError } : { data: rows(), error: null })
    const q = {
      then: (onF, onR) => (store.defer
        ? new Promise((res) => store.pending.push({ table, resolve: () => res(settle()) }))
        : Promise.resolve(settle())
      ).then(onF, onR),
    }
    ;['select', 'order', 'in'].forEach((m) => { q[m] = () => q })
    q.eq = (c, v) => { filters.push([c, v]); return q }
    q.insert = () => { write = true; return q }
    q.delete = () => { write = true; return q }
    return q
  }
  return { supabase: { from: make } }
})
vi.mock('../lib/logger', () => ({ logError }))

import { useCompetitionSquad } from './useCompetitionSquad'

beforeEach(() => {
  logError.mockClear()
  store.pending.length = 0
  store.defer = false
  store.writeError = null
  store.tables = {
    competition_squads: [
      { competition_id: 'c1', profile_id: 'p-c1' },
      { competition_id: 'c2', profile_id: 'p-c2' },
    ],
  }
})

describe('useCompetitionSquad — latest request wins', () => {
  test('a slower, older competition load does not overwrite the newer one', async () => {
    store.defer = true
    const { result, rerender } = renderHook(({ id }) => useCompetitionSquad(id), { initialProps: { id: 'c1' } })
    await waitFor(() => expect(store.pending).toHaveLength(1))

    rerender({ id: 'c2' })
    await waitFor(() => expect(store.pending).toHaveLength(2))

    await act(async () => { store.pending[1].resolve() }) // c2 first
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect([...result.current.registered]).toEqual(['p-c2'])

    await act(async () => { store.pending[0].resolve() }) // stale c1, late
    expect([...result.current.registered]).toEqual(['p-c2'])
    expect(result.current.loading).toBe(false)
  })
})

describe('useCompetitionSquad — write failures are logged with the error itself', () => {
  test('a failed add logs the error object (code/status travel with it), not just its message', async () => {
    const { result } = renderHook(() => useCompetitionSquad('c1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    store.writeError = { message: 'squad full', code: 'P0001' }
    let res
    await act(async () => { res = await result.current.add('p-new') })
    expect(res.error).toBeTruthy()
    expect(logError).toHaveBeenCalledWith('write', expect.objectContaining({ message: 'squad full', code: 'P0001' }), expect.objectContaining({ op: 'squad.add' }))
    expect(result.current.registered.has('p-new')).toBe(false)
  })

  test('a failed remove logs the error object too', async () => {
    const { result } = renderHook(() => useCompetitionSquad('c1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    store.writeError = { message: 'nope', code: '42501' }
    await act(async () => { await result.current.remove('p-c1') })
    expect(logError).toHaveBeenCalledWith('write', expect.objectContaining({ message: 'nope', code: '42501' }), expect.objectContaining({ op: 'squad.remove' }))
    expect(result.current.registered.has('p-c1')).toBe(true)
  })
})
