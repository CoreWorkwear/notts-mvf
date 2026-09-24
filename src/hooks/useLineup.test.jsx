import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'

// A store-backed mock that behaves enough like the database for the save path:
// .eq() filters are honoured on reads AND deletes, inserts append to the table
// (or fail with the next queued error in `failInserts`), and `defer` parks every
// response in `pending` so a test can settle them out of order.
const store = vi.hoisted(() => ({ tables: {}, calls: [], pending: [], defer: false, failInserts: [] }))
vi.mock('../lib/supabase', () => {
  const make = (table) => {
    const call = { table, ops: [], filters: [], write: null, payload: null }
    store.calls.push(call)
    const matches = (r) => call.filters.every(([c, v]) => r[c] === undefined || r[c] === v)
    const settle = () => {
      const rows = store.tables[table] ?? []
      if (call.write === 'delete') { store.tables[table] = rows.filter((r) => !matches(r)); return { data: null, error: null } }
      if (call.write === 'insert') {
        const err = store.failInserts.shift()
        if (err) return { data: null, error: err }
        store.tables[table] = rows.concat(call.payload)
        return { data: null, error: null }
      }
      return { data: rows.filter(matches), error: null }
    }
    const q = {
      then: (onF, onR) => (store.defer
        ? new Promise((res) => store.pending.push({ table, resolve: () => res(settle()) }))
        : Promise.resolve(settle())
      ).then(onF, onR),
    }
    ;['select', 'order', 'in'].forEach((m) => { q[m] = (...a) => { call.ops.push([m, ...a]); return q } })
    q.eq = (c, v) => { call.ops.push(['eq', c, v]); call.filters.push([c, v]); return q }
    q.delete = () => { call.write = 'delete'; call.ops.push(['delete']); return q }
    q.insert = (p) => { call.write = 'insert'; call.payload = [].concat(p); call.ops.push(['insert']); return q }
    return q
  }
  return { supabase: { from: make } }
})
vi.mock('../lib/logger', () => ({ logError: vi.fn() }))

import { useLineup } from './useLineup'

const row = (fixture_id, profile_id, first, last, over = {}) => ({
  fixture_id, profile_id, player_name: `${first} ${last}`, role: 'start', slot: 0, position: 'GK', formation: '4-4-2',
  profiles: { first_name: first, last_name: last, photo_url: null },
  ...over,
})

beforeEach(() => {
  store.calls.length = 0
  store.pending.length = 0
  store.defer = false
  store.failInserts = []
  store.tables = {
    lineups: [row('A', 'p1', 'Joe', 'Bloggs')],
    availability: [],
  }
})

describe('useLineup — never leaves the board hanging', () => {
  test('no fixture resolves loading to false (not a permanent "Loading the line-up…")', async () => {
    const { result } = renderHook(() => useLineup(null, true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasLineup).toBe(false)
  })
})

// save() is delete-then-insert. When the insert failed the database was left
// with NO line-up while the hook still showed the old one — the manager saw a
// picked XI that the players couldn't.
describe('useLineup — a failed save does not silently wipe the line-up', () => {
  test('insert fails → the previous line-up is put back and the hook shows what the database holds', async () => {
    const { result } = renderHook(() => useLineup({ id: 'A' }, true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasLineup).toBe(true)

    store.failInserts = [{ message: 'insert failed', code: '23505' }]
    let res
    await act(async () => { res = await result.current.save([row('A', 'p2', 'Sam', 'Lee')]) })

    expect(res.error).toBeTruthy()
    // The database still has the old XI (restored from the snapshot)…
    expect(store.tables.lineups.filter((r) => r.fixture_id === 'A').map((r) => r.profile_id)).toEqual(['p1'])
    // …and the hook agrees with it.
    expect(result.current.hasLineup).toBe(true)
    expect(result.current.saved.starters[0]).toBe('p1')
  })

  test('insert AND restore fail → the hook reflects the (now empty) database rather than the stale XI', async () => {
    const { result } = renderHook(() => useLineup({ id: 'A' }, true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasLineup).toBe(true)

    store.failInserts = [{ message: 'insert failed' }, { message: 'restore failed' }]
    let res
    await act(async () => { res = await result.current.save([row('A', 'p2', 'Sam', 'Lee')]) })

    expect(res.error).toBeTruthy()
    expect(store.tables.lineups.filter((r) => r.fixture_id === 'A')).toHaveLength(0)
    expect(result.current.hasLineup).toBe(false) // matches the database — no phantom XI
  })
})

// Opening fixture A's line-up (slow) then fixture B's (fast): A's response
// landed last and showed A's XI under B — and a save would have written it to B.
describe('useLineup — latest request wins', () => {
  test('a slower, older fixture load does not overwrite the newer one', async () => {
    store.defer = true
    store.tables.lineups = [row('A', 'p1', 'Joe', 'Bloggs'), row('B', 'p2', 'Sam', 'Lee')]

    const { result, rerender } = renderHook(({ fixture }) => useLineup(fixture, true), { initialProps: { fixture: { id: 'A' } } })
    await waitFor(() => expect(store.pending).toHaveLength(2)) // lineups + availability for A

    rerender({ fixture: { id: 'B' } })
    await waitFor(() => expect(store.pending).toHaveLength(4)) // + lineups + availability for B

    await act(async () => { store.pending[2].resolve(); store.pending[3].resolve() }) // B first
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.saved.starters[0]).toBe('p2')

    await act(async () => { store.pending[0].resolve(); store.pending[1].resolve() }) // stale A, late
    expect(result.current.saved.starters[0]).toBe('p2')
    expect(result.current.names).toEqual({ p2: 'Sam Lee' })
    expect(result.current.loading).toBe(false)
  })
})
