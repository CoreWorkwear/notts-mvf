import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

// The landing surface. Three things it must not lie about:
//  - a profile that hasn't loaded yet is NOT a player awaiting sign-off;
//  - "You're in for N of the next M" only counts games this player can answer;
//  - a result logged when the squad list failed to load would save scorers as
//    free text (stats key by profile_id) — refuse and say so instead.
const auth = vi.hoisted(() => ({ state: {} }))
const fx = vi.hoisted(() => ({ state: {} }))
const db = vi.hoisted(() => ({ profiles: [], error: null }))
const resultForm = vi.hoisted(() => ({ props: null }))

vi.mock('../context/AuthContext', () => ({ useAuth: () => auth.state }))
vi.mock('../context/SeasonContext', () => ({ useSeason: () => ({ seasonId: 's1', error: null, refreshSeasons: vi.fn() }) }))
vi.mock('../hooks/useFixtures', () => ({ useFixtures: () => fx.state, setAvailability: vi.fn(async () => ({ error: null })) }))
vi.mock('../hooks/useCompetitions', () => ({ useCompetitions: () => ({ competitions: [] }) }))
vi.mock('../hooks/useMedia', () => ({ usePhotoPool: () => [] }))
vi.mock('../lib/logger', () => ({ logError: vi.fn() }))
vi.mock('../lib/supabase', () => {
  const q = {
    select: () => q, eq: () => q, order: () => q,
    then: (res, rej) => Promise.resolve({ data: db.error ? null : db.profiles, error: db.error }).then(res, rej),
  }
  return { supabase: { from: () => q } }
})
vi.mock('../components/FixtureHero', () => ({ default: ({ fixture, onOpenDetail }) => <div>HERO {fixture.id}<button onClick={onOpenDetail}>OPEN-DETAIL</button></div> }))
vi.mock('../components/FixtureStrip', () => ({ default: ({ fixture }) => <div>STRIP {fixture.id}</div> }))
vi.mock('../components/FixtureDetail', () => ({ default: ({ open, onLogResult }) => (open ? <button onClick={onLogResult}>LOG-RESULT</button> : null) }))
vi.mock('../components/FixtureForm', () => ({ default: () => null }))
vi.mock('../components/CalendarView', () => ({ default: () => null }))
vi.mock('../components/ResultForm', () => ({ default: (props) => { resultForm.props = props; return props.open ? <div>RESULT-FORM-OPEN</div> : null } }))

import Fixtures from './Fixtures'

const fixture = (id, key, over = {}) => ({
  id, match_date: '2030-05-03', kickoff: '14:00:00', home_away: 'Home', fixture_type: 'League', venue: 'X',
  team: { id: 't-' + key, key, label: key === 'xl' ? 'First Team' : 'Community' }, team_id: 't-' + key,
  opponent: { name: 'Opp ' + id }, counts: { in: 0, maybe: 0, out: 0 }, myStatus: null, replied: 0, noReply: 0,
  rosterSize: 0, hasResult: false, postponed: false, concluded: false, ...over,
})

const playerAuth = {
  user: { id: 'u1' }, profile: { id: 'u1', first_name: 'Joe', approved: true, active: true, is_player: true },
  isAdmin: false, teamKeys: ['community'], canRespond: true, accountStatus: 'active', respondBlockFor: () => null,
}

beforeEach(() => {
  auth.state = { ...playerAuth }
  db.profiles = []; db.error = null
  resultForm.props = null
  fx.state = { upcoming: [], past: [], teams: [], opponents: [], fixtures: [], loading: false, error: null, refetch: vi.fn(), applyMyStatus: vi.fn() }
})

const renderPage = () => render(<MemoryRouter><Fixtures /></MemoryRouter>)

describe('Fixtures — no phantom "sign you off" banner before the profile has loaded', () => {
  test('profile=null (still loading) shows no account banner', () => {
    auth.state = { ...playerAuth, profile: null, canRespond: false, accountStatus: 'active', respondBlockFor: () => 'unknown' }
    renderPage()
    expect(screen.queryByText(/sign you off/i)).toBeNull()
  })

  test('a genuinely pending player still gets the banner', () => {
    auth.state = { ...playerAuth, profile: { id: 'u1', approved: false }, canRespond: false, accountStatus: 'pending' }
    renderPage()
    expect(screen.getByText(/sign you off/i)).toBeInTheDocument()
  })
})

describe('Fixtures — the status line counts only games this player can answer', () => {
  test('a Community-only player with a First Team game next: "1 of the next 1", not "of the next 3"', () => {
    const ft1 = fixture('ft1', 'xl'), co1 = fixture('co1', 'community', { myStatus: 'in' }), ft2 = fixture('ft2', 'xl')
    fx.state = { ...fx.state, upcoming: [ft1, co1, ft2], fixtures: [ft1, co1, ft2] }
    auth.state = { ...playerAuth, respondBlockFor: (f) => (f?.team?.key === 'xl' ? 'other-team' : null) }
    renderPage()
    expect(screen.getByText(/you're in for 1 of the next 1/i)).toBeInTheDocument()
  })

  test('a postponed game never counts towards the next games', () => {
    const co1 = fixture('co1', 'community', { myStatus: 'in' }), pp = fixture('pp', 'community', { postponed: true })
    fx.state = { ...fx.state, upcoming: [co1, pp], fixtures: [co1, pp] }
    renderPage()
    expect(screen.getByText(/you're in for 1 of the next 1/i)).toBeInTheDocument()
  })
})

describe('Fixtures — logging a result needs the squad list (stats key by profile_id)', () => {
  const adminAuth = { ...playerAuth, isAdmin: true, profile: { id: 'u1', role: 'admin', approved: true, active: true, is_player: true } }

  test('a failed squad fetch blocks the result form with a visible reason, and a retry that succeeds opens it', async () => {
    const f = fixture('f1', 'xl', { concluded: false })
    fx.state = { ...fx.state, upcoming: [f], fixtures: [f] }
    auth.state = adminAuth
    db.error = { message: 'Load failed' }
    renderPage()
    await userEvent.click(screen.getByText('OPEN-DETAIL'))
    await userEvent.click(screen.getByText('LOG-RESULT'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/squad list didn't load/i)
    expect(screen.queryByText('RESULT-FORM-OPEN')).toBeNull()

    // Signal's back: the next tap re-fetches and opens the form.
    db.error = null
    db.profiles = [{ id: 'p1', first_name: 'Joe', last_name: 'Morris', active: true }]
    await userEvent.click(screen.getByText('OPEN-DETAIL'))
    await userEvent.click(screen.getByText('LOG-RESULT'))
    expect(await screen.findByText('RESULT-FORM-OPEN')).toBeInTheDocument()
  })

  test('the form gets the ACTIVE squad for its pickers and EVERYONE (incl. inactive) for resolving old results', async () => {
    const f = fixture('f1', 'xl')
    fx.state = { ...fx.state, upcoming: [f], fixtures: [f] }
    auth.state = adminAuth
    db.profiles = [
      { id: 'p1', first_name: 'Joe', last_name: 'Morris', active: true },
      { id: 'p-old', first_name: 'Old', last_name: 'Lad', active: false },
    ]
    renderPage()
    await waitFor(() => expect(resultForm.props?.everyone?.length).toBe(2))
    expect(resultForm.props.squad.map((p) => p.id)).toEqual(['p1'])
    expect(resultForm.props.everyone.map((p) => p.id).sort()).toEqual(['p-old', 'p1'])
  })
})
