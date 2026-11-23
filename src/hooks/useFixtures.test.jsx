import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'

const store = vi.hoisted(() => ({ tables: {}, reject: false, respErr: false, calls: 0, hold: false, held: [], write: vi.fn() }))
vi.mock('../lib/supabase', () => {
  const make = (table) => {
    store.calls++
    // store.reject simulates a network-level fetch failure (the WebKit
    // "TypeError: Load failed" seen in prod), where the promise REJECTS rather
    // than resolving to { data, error }. store.respErr simulates a RESPONSE-
    // level error (RLS, 5xx): resolves with { data: null, error }.
    // Data is snapshotted when the request is MADE (as a real response would
    // be), and store.hold parks the response until the test releases it — the
    // stale-response test needs an older request to resolve after a newer one.
    const snapshot = JSON.parse(JSON.stringify(store.tables[table] ?? []))
    const gate = store.hold ? new Promise((r) => store.held.push(r)) : Promise.resolve()
    const q = {
      upsert: (row) => store.write(row),
      then: (onF, onR) => gate.then(() => (store.reject
        ? Promise.reject(new TypeError('Load failed'))
        : Promise.resolve(store.respErr
          ? { data: null, error: { message: 'RLS said no' } }
          : { data: snapshot, error: null })
      )).then(onF, onR),
    }
    ;['select', 'eq', 'order', 'in', 'gte', 'lte'].forEach((m) => { q[m] = () => q })
    return q
  }
  return { supabase: { from: make } }
})
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))

import { useFixtures, saveFixtureAnswer } from './useFixtures'

beforeEach(() => {
  store.reject = false
  store.respErr = false
  store.calls = 0
  store.hold = false
  store.held = []
  store.write.mockReset()
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

describe('an availability tap on a slow connection', () => {
  test('the selection survives a stale read and route remount, and confirms before the next read finishes', async () => {
    store.tables.team_memberships = [{ team_id: 't1', profiles: { id: 'u1', active: true, approved: true, is_player: true } }]
    let finishWrite
    store.write.mockImplementation(() => new Promise(resolve => { finishWrite = resolve }))
    const first = renderHook(() => useFixtures('s1'))
    await waitFor(() => expect(first.result.current.loaded).toBe(true))
    let saving
    act(() => { saving = saveFixtureAnswer('fix-1', 'u1', 'in') })
    expect(first.result.current.fixtures[0]).toMatchObject({ myStatus: 'in', availabilityPending: true, noReply: 0 })
    first.unmount()
    const { result } = renderHook(() => useFixtures('s1'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.fixtures[0]).toMatchObject({ myStatus: 'in', availabilityPending: true })
    await act(async () => { expect(await saveFixtureAnswer('fix-1', 'u1', 'out')).toBe(false) })
    expect(store.write).toHaveBeenCalledTimes(1)

    store.hold = true
    act(() => { result.current.refetch() })
    const calls = store.calls
    await act(async () => { finishWrite({ error: null }); expect(await saving).toBe(true) })
    expect(store.calls).toBe(calls)
    expect(result.current.fixtures[0].availabilityPending).toBeFalsy()
    await act(async () => { store.held.splice(0).forEach(release => release()) })
    expect(result.current.fixtures[0]).toMatchObject({ myStatus: 'in', counts: { in: 1 }, noReply: 0 })
  })

  test('two rejected writes roll back the selected answer and reply count', async () => {
    store.tables.team_memberships = [{ team_id: 't1', profiles: { id: 'u1', active: true, approved: true, is_player: true } }]
    store.write.mockRejectedValue(new TypeError('Load failed'))
    const { result } = renderHook(() => useFixtures('s1'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    await act(async () => { expect(await saveFixtureAnswer('fix-1', 'u1', 'maybe')).toBe(false) })
    expect(store.write).toHaveBeenCalledTimes(2)
    expect(result.current.fixtures[0]).toMatchObject({ myStatus: null, counts: { maybe: 0 }, noReply: 1 })
    expect(result.current.fixtures[0].availabilityPending).toBeFalsy()
  })
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

  test('the in/maybe/out tally counts squad answers only, so noReply stays honest', async () => {
    store.tables = {
      fixtures: [{
        id: 'ft-2', match_date: '2026-12-01', kickoff: '13:00:00', home_away: 'Home',
        fixture_type: 'League', league_name: null, venue: 'X', address: null, w3w: null,
        season_id: 's1', team_id: 't-first',
        team: { id: 't-first', key: 'xl', label: 'First Team', colour: '#E11D2A', is_first_team: true },
        opponent: { id: 'o1', name: 'Carlton Town', badge_url: null },
        availability: [
          { profile_id: 'a', status: 'in' },          // squad
          { profile_id: 'sup', status: 'in' },        // supporter
          { profile_id: 'pend', status: 'maybe' },    // awaiting sign-off
          { profile_id: 'gone', status: 'out' },      // removed player
          { profile_id: 'res', status: 'in' },        // reserves — not this squad
        ],
        results: null,
      }],
      teams: [{ id: 't-first', key: 'xl', label: 'First Team', colour: '#E11D2A', is_first_team: true, league_name: null }],
      opponents: [],
      team_memberships: [
        { team_id: 't-first', profiles: { id: 'a', active: true, approved: true, is_player: true } },
        { team_id: 't-first', profiles: { id: 'b', active: true, approved: true, is_player: true } },
        { team_id: 't-first', profiles: { id: 'sup', active: true, approved: true, is_player: false } },
        { team_id: 't-first', profiles: { id: 'pend', active: true, approved: false, is_player: true } },
        { team_id: 't-first', profiles: { id: 'gone', active: false, approved: true, is_player: true } },
        { team_id: 't-community', profiles: { id: 'res', active: true, approved: true, is_player: true } },
      ],
    }
    const { result } = renderHook(() => useFixtures('s1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const f = result.current.fixtures.find((x) => x.id === 'ft-2')
    expect(f.counts).toEqual({ in: 1, maybe: 0, out: 0 }) // only 'a'
    expect(f.rosterSize).toBe(2)                          // a + b
    expect(f.replied).toBe(1)
    expect(f.noReply).toBe(1)                             // b, and b alone
  })

  test('your own answer still shows even when it no longer counts', async () => {
    store.tables = {
      fixtures: [{
        id: 'ft-3', match_date: '2026-12-01', kickoff: '13:00:00', home_away: 'Home',
        fixture_type: 'League', league_name: null, venue: 'X', address: null, w3w: null,
        season_id: 's1', team_id: 't-first',
        team: { id: 't-first', key: 'xl', label: 'First Team', colour: '#E11D2A', is_first_team: true },
        opponent: { id: 'o1', name: 'Carlton Town', badge_url: null },
        availability: [{ profile_id: 'u1', status: 'in' }], // the viewer, off this squad
        results: null,
      }],
      teams: [{ id: 't-first', key: 'xl', label: 'First Team', colour: '#E11D2A', is_first_team: true, league_name: null }],
      opponents: [],
      team_memberships: [{ team_id: 't-community', profiles: { id: 'u1', active: true, approved: true, is_player: true } }],
    }
    const { result } = renderHook(() => useFixtures('s1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const f = result.current.fixtures.find((x) => x.id === 'ft-3')
    expect(f.myStatus).toBe('in')   // honest about what you said
    expect(f.counts.in).toBe(0)     // but it isn't a body for this game
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

// A response-level error (RLS, 5xx) resolves with { data: null, error } — the
// hook used to log it, wipe the fixtures to [] and leave error null, so the
// screen rendered a confident "Nothing in the diary yet" lie.
describe('useFixtures — a response-level error is not an empty diary', () => {
  test('an errored refetch keeps the fixtures and sets error', async () => {
    const { result } = renderHook(() => useFixtures('s1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.fixtures).toHaveLength(1)

    store.respErr = true
    await act(async () => { window.dispatchEvent(new Event('mvf-availability-applied')) })
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.fixtures).toHaveLength(1) // previous data survives
  })
})

// Foregrounding an installed PWA fires window `focus` AND `visibilitychange`
// back-to-back; each used to trigger a full 4-query load (8 requests per app
// switch, and the fixtures query is the busiest statement on the database).
describe('useFixtures — focus refetch throttle', () => {
  test('focus + visibilitychange right after a load do NOT repeat it', async () => {
    const { result } = renderHook(() => useFixtures('s1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const settled = store.calls
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise((r) => setTimeout(r, 50))
    expect(store.calls).toBe(settled) // both throttled — the load just ran
  })

  test('an availability push action always refetches (a write just committed — never throttled)', async () => {
    const { result } = renderHook(() => useFixtures('s1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const settled = store.calls
    await act(async () => { window.dispatchEvent(new Event('mvf-availability-applied')) })
    await waitFor(() => expect(store.calls).toBeGreaterThan(settled))
  })
})

// Latest-wins: no loader guarded against a SLOWER, OLDER response landing
// after a newer one. Real sequence on a phone waking its radio: foreground →
// load #1 starts on a cold connection; the player taps In → the write lands →
// refetch (#2) resolves first on the warm connection; #1 then arrives with the
// pre-tap snapshot and reverts the tap. The DB says "in"; the screen says "—".
describe('useFixtures — a stale response never overwrites a newer one', () => {
  test('the newer load stands even when the older one resolves last', async () => {
    const { result } = renderHook(() => useFixtures('s1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.fixtures[0].myStatus).toBeNull()

    // Load #2 (stale): snapshots the empty availability and is HELD.
    store.hold = true
    act(() => { window.dispatchEvent(new Event('mvf-availability-applied')) })
    await waitFor(() => expect(store.held.length).toBeGreaterThanOrEqual(4))
    const stale = store.held.splice(0)

    // The tap lands; load #3 snapshots the new row and is released FIRST.
    store.tables.fixtures[0].availability = [{ profile_id: 'u1', status: 'in' }]
    act(() => { result.current.refetch() })
    await waitFor(() => expect(store.held.length).toBeGreaterThanOrEqual(4))
    const fresh = store.held.splice(0)
    await act(async () => { fresh.forEach((r) => r()) })
    await waitFor(() => expect(result.current.fixtures[0].myStatus).toBe('in'))

    // Now the stale one lands.
    await act(async () => { stale.forEach((r) => r()) })
    await new Promise((r) => setTimeout(r, 20))
    expect(result.current.fixtures[0].myStatus).toBe('in')
  })
})

// The roster is the approved active squad for that team; answers from anyone
// else (a player since deactivated / moved squads — their availability row is
// never cascaded away) must not count, or the hero's "N not replied" disagrees
// with the Who's In sheet, which derives it per roster member.
describe('useFixtures — counts and noReply are roster-based', () => {
  test('an answer from someone not on the roster neither counts nor reduces noReply', async () => {
    store.tables.fixtures[0].team_id = 't-first'
    store.tables.fixtures[0].availability = [
      { profile_id: 'a', status: 'in' },      // on the roster
      { profile_id: 'zed', status: 'in' },    // deactivated since answering
    ]
    store.tables.team_memberships = [
      { team_id: 't-first', profiles: { id: 'a', active: true, approved: true, is_player: true } },
      { team_id: 't-first', profiles: { id: 'b', active: true, approved: true, is_player: true } },
      { team_id: 't-first', profiles: { id: 'zed', active: false, approved: true, is_player: true } },
    ]
    const { result } = renderHook(() => useFixtures('s1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const f = result.current.fixtures[0]
    expect(f.rosterSize).toBe(2)
    expect(f.counts.in).toBe(1)
    expect(f.replied).toBe(1)
    expect(f.noReply).toBe(1) // b — not 0
  })
})

// `loaded`: has a load ever COMPLETED? Pages used "loading && list is empty" to
// mean "first load", which is also true on every refetch of a season that
// really has no fixtures: the page swapped to the Loader, unmounting an open
// Add-a-fixture form, and a manager back from WhatsApp with the postcode found
// it blank.
describe('useFixtures — loaded', () => {
  test('false until the first load completes, then true (even when the season is empty)', async () => {
    store.tables.fixtures = []
    const { result } = renderHook(() => useFixtures('s1'))
    expect(result.current.loaded).toBe(false)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.loaded).toBe(true)
    expect(result.current.fixtures).toEqual([])
  })

  test('a first load that fails is not "loaded"', async () => {
    store.respErr = true
    const { result } = renderHook(() => useFixtures('s1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.loaded).toBe(false)
    expect(result.current.error).toBeTruthy()
  })

  test('stays true through a later refetch, including one that fails', async () => {
    const { result } = renderHook(() => useFixtures('s1'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    store.respErr = true
    await act(async () => { await result.current.refetch() })
    expect(result.current.loaded).toBe(true)
    expect(result.current.error).toBeTruthy()
  })
})

// `loaded` answers for the season on screen. Carried over from another season
// it made a failed load of THIS one read as an empty diary ("Nothing in the
// diary yet", no error, no retry) after viewing a season with no fixtures.
describe('useFixtures — loaded is per season', () => {
  test('switching season: not loaded again until that season\u2019s own load completes', async () => {
    const { result, rerender } = renderHook(({ s }) => useFixtures(s), { initialProps: { s: 's1' } })
    await waitFor(() => expect(result.current.loaded).toBe(true))

    store.hold = true
    rerender({ s: 's2' })
    expect(result.current.loaded).toBe(false)
    await act(async () => { store.held.splice(0).forEach((r) => r()) })
    await waitFor(() => expect(result.current.loaded).toBe(true))
  })

  test('a failed load of the season switched to is not "loaded"', async () => {
    const { result, rerender } = renderHook(({ s }) => useFixtures(s), { initialProps: { s: 's1' } })
    await waitFor(() => expect(result.current.loaded).toBe(true))

    store.respErr = true
    rerender({ s: 's2' })
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.loaded).toBe(false)
  })
})
