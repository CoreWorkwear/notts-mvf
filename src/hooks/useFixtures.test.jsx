import { renderHook, waitFor } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'

const store = vi.hoisted(() => ({ tables: {} }))
vi.mock('../lib/supabase', () => {
  const make = (table) => {
    const q = { then: (res) => Promise.resolve({ data: store.tables[table] ?? [], error: null }).then(res) }
    ;['select', 'eq', 'order', 'in', 'gte', 'lte'].forEach((m) => { q[m] = () => q })
    return q
  }
  return { supabase: { from: make } }
})
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))

import { useFixtures } from './useFixtures'

beforeEach(() => {
  store.tables = {
    fixtures: [{
      id: 'fix-1', match_date: '2026-12-01', kickoff: '13:00:00', home_away: 'Home',
      fixture_type: 'League', league_name: null, venue: 'X', address: null, w3w: null,
      season_id: 's1', team_id: 't1',
      team: { id: 't1', key: 'community', label: 'Community', colour: '#2FA84F', is_first_team: false },
      opponent: { id: 'o1', name: 'Long Eaton', badge_url: null },
      availability: [],
      results: { fixture_id: 'fix-1' }, // OBJECT (one-to-one), as PostgREST returns
    }],
    teams: [{ id: 't1', key: 'community', label: 'Community', colour: '#2FA84F', is_first_team: false, league_name: null }],
    opponents: [],
    team_memberships: [],
  }
})

describe('useFixtures — one-to-one results embed', () => {
  test('a fixture WITH a result is flagged hasResult (so the lifecycle can move it)', async () => {
    const { result } = renderHook(() => useFixtures('s1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const f = result.current.fixtures.find((x) => x.id === 'fix-1')
    expect(f).toBeTruthy()
    expect(f.hasResult).toBe(true)
  })
})
