import { renderHook, waitFor } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'

const store = vi.hoisted(() => ({ tables: {}, reject: false }))
vi.mock('../lib/supabase', () => {
  const make = (table) => {
    // store.reject simulates a network-level fetch failure (the WebKit
    // "TypeError: Load failed" seen in prod), where the promise REJECTS rather
    // than resolving to { data, error }.
    const q = {
      then: (onF, onR) => (store.reject
        ? Promise.reject(new TypeError('Load failed'))
        : Promise.resolve({ data: store.tables[table] ?? [], error: null })
      ).then(onF, onR),
    }
    ;['select', 'eq', 'order', 'in', 'gte', 'lte'].forEach((m) => { q[m] = () => q })
    return q
  }
  return { supabase: { from: make } }
})
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))

import { useFixtures } from './useFixtures'

beforeEach(() => {
  store.reject = false
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

  test('a team roster/no-reply counts approved active players and excludes inactive, pending and supporter members (no eligibility gate)', async () => {
    store.tables = {
      fixtures: [{
        id: 'ft-1', match_date: '2026-12-01', kickoff: '13:00:00', home_away: 'Home',
        fixture_type: 'League', league_name: null, venue: 'X', address: null, w3w: null,
        season_id: 's1', team_id: 't-first',
        team: { id: 't-first', key: 'xl', label: 'First Team', colour: '#E11D2A', is_first_team: true },
        opponent: { id: 'o1', name: 'Carlton Town', badge_url: null },
        availability: [], results: null,
      }],
      teams: [{ id: 't-first', key: 'xl', label: 'First Team', colour: '#E11D2A', is_first_team: true, league_name: null }],
      opponents: [],
      team_memberships: [
        { team_id: 't-first', profiles: { id: 'a', active: true, approved: true, is_player: true } },   // counts
        { team_id: 't-first', profiles: { id: 'b', active: true, approved: true, is_player: true } },   // counts (was "not eligible" — now no such concept)
        { team_id: 't-first', profiles: { id: 'c', active: false, approved: true, is_player: true } },  // inactive
        { team_id: 't-first', profiles: { id: 'd', active: true, approved: false, is_player: true } },  // pending
        { team_id: 't-first', profiles: { id: 'e', active: true, approved: true, is_player: false } },  // supporter
      ],
    }
    const { result } = renderHook(() => useFixtures('s1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const f = result.current.fixtures.find((x) => x.id === 'ft-1')
    expect(f.rosterSize).toBe(2) // a + b (eligibility no longer filters)
    expect(f.noReply).toBe(2)
  })
})

// Regression: the live "hang after login on Fixtures". The screen shows a
// permanent "Pulling the fixtures…" loader whenever the hook's `loading` never
// returns to false. Two ways that happened, both proven from prod:
//  - a read fetch REJECTS (unhandled "TypeError: Load failed" on /fixtures in
//    client_errors) and setLoading(false) is skipped;
//  - seasonId is null and load() early-returns without clearing loading.
describe('useFixtures — never leaves the screen hanging', () => {
  test('a rejected fetch (flaky network) resolves loading to false, not an infinite loader', async () => {
    store.reject = true
    const { result } = renderHook(() => useFixtures('s1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeTruthy() // surfaced so the UI can offer a retry
  })

  test('a null seasonId resolves loading to false (no spinner before a season resolves)', async () => {
    const { result } = renderHook(() => useFixtures(null))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.fixtures).toEqual([])
  })
})
