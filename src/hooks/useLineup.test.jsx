import { renderHook, waitFor } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'

// The mock returns whatever's in store.tables for the table being queried — it
// does NOT re-implement .eq(), so team_memberships holds only the rows the real
// `.eq('team_id', fixture.team_id)` would have come back with.
const store = vi.hoisted(() => ({ tables: {} }))
vi.mock('../lib/supabase', () => {
  const make = (table) => {
    const q = { then: (onF, onR) => Promise.resolve({ data: store.tables[table] ?? [], error: null }).then(onF, onR) }
    ;['select', 'eq', 'in', 'order'].forEach((m) => { q[m] = () => q })
    return q
  }
  return { supabase: { from: make } }
})

import { useLineup } from './useLineup'

const FIXTURE = { id: 'fix-1', team_id: 't-first' }

const squad = (id, first, over = {}) => ({
  profiles: { id, first_name: first, last_name: 'X', active: true, approved: true, is_player: true, ...over },
})
const avail = (id, first, status = 'in') => ({
  status, profiles: { id, first_name: first, last_name: 'X', photo_url: null },
})

beforeEach(() => { store.tables = {} })

describe('useLineup — the pick pool is the fixture team’s squad', () => {
  test('keeps approved, active players of this team and drops everyone else', async () => {
    store.tables = {
      lineups: [],
      // Everyone below answered the First Team game.
      availability: [
        avail('p-ok', 'Keeper'),
        avail('p-supporter', 'Sue', 'maybe'),
        avail('p-pending', 'Pat'),
        avail('p-gone', 'Ollie'),
        avail('p-community', 'Cal'), // reserves — no First Team membership row
      ],
      // The First Team roster as the DB would return it for team_id = 't-first'.
      team_memberships: [
        squad('p-ok', 'Keeper'),
        squad('p-supporter', 'Sue', { is_player: false }),
        squad('p-pending', 'Pat', { approved: false }),
        squad('p-gone', 'Ollie', { active: false }),
      ],
    }

    const { result } = renderHook(() => useLineup(FIXTURE, true))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.pool.map((p) => p.id)).toEqual(['p-ok'])
  })

  test('a fixture with no resolvable team offers nobody (fails closed)', async () => {
    store.tables = {
      lineups: [],
      availability: [avail('p-ok', 'Keeper')],
      team_memberships: [squad('p-ok', 'Keeper')],
    }

    const { result } = renderHook(() => useLineup({ id: 'fix-2' }, true))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.pool).toEqual([])
  })

  test('a picked player still resolves by name even once they are off the pool', async () => {
    store.tables = {
      lineups: [
        { profile_id: 'p-gone', player_name: 'Ollie X', role: 'start', slot: 0, position: 'GK', formation: '4-4-2', profiles: { first_name: 'Ollie', last_name: 'X', photo_url: null } },
      ],
      availability: [avail('p-gone', 'Ollie')],
      team_memberships: [squad('p-gone', 'Ollie', { active: false })],
    }

    const { result } = renderHook(() => useLineup(FIXTURE, true))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.pool).toEqual([])
    expect(result.current.names['p-gone']).toBe('Ollie X')
    expect(result.current.saved.starters[0]).toBe('p-gone')
  })
})
