import { renderHook, waitFor } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'

// PostgREST returns a one-to-one embed (fixtures→results) as an OBJECT, not an
// array (verified against the live API). The mock returns that real shape.
const store = vi.hoisted(() => ({ tables: {} }))
vi.mock('../lib/supabase', () => {
  const make = (table) => {
    const q = { then: (res) => Promise.resolve({ data: store.tables[table] ?? [], error: null }).then(res) }
    ;['select', 'eq', 'order', 'in', 'gte', 'lte'].forEach((m) => { q[m] = () => q })
    return q
  }
  return { supabase: { from: make } }
})

import { useResults } from './useResults'

beforeEach(() => {
  store.tables = {
    fixtures: [{
      id: 'fix-1', match_date: '2026-01-01', kickoff: '13:00:00', home_away: 'Home',
      fixture_type: 'League', league_name: null, venue: 'Derby Racecourse', team_id: 't1',
      team: { id: 't1', key: 'community', label: 'Community', colour: '#2FA84F' },
      opponent: { id: 'o1', name: 'Long Eaton', badge_url: null },
      result: { ht_us: 1, ht_them: 2, us: 2, them: 4, motm_profile_id: null, motm_name: null }, // OBJECT
      goals: [],
    }],
    profiles: [],
  }
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
