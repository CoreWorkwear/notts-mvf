import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'

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
vi.mock('../hooks/useFixtures', () => ({ useFixtures: () => fx.state, saveFixtureAnswer: vi.fn(async () => true) }))
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
// Honours canLogResult, like the real sheet: the button is the thing under test.
const detailProps = vi.hoisted(() => ({ last: null }))
vi.mock('../components/FixtureDetail', () => ({ default: (props) => {
  detailProps.last = props
  const { open, canLogResult, onLogResult } = props
  return (
  open ? (canLogResult ? <button onClick={onLogResult}>LOG-RESULT</button> : <span>DETAIL-OPEN</span>) : null
  )
} }))
vi.mock('../components/FixtureForm', () => ({ default: () => null }))
// The calendar is the one view that lists EVERY game of the season, played ones included.
vi.mock('../components/CalendarView', () => ({ default: ({ fixtures, onOpen }) => (
  <div>{fixtures.map((f) => <button key={f.id} onClick={() => onOpen(f)}>CAL {f.id}</button>)}</div>
) }))
vi.mock('../components/ResultForm', () => ({ default: (props) => { resultForm.props = props; return props.open ? <div>RESULT-FORM-OPEN</div> : null } }))

import Fixtures from './Fixtures'
import { saveFixtureAnswer } from '../hooks/useFixtures'

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
  fx.state = { upcoming: [], past: [], teams: [], opponents: [], fixtures: [], loading: false, error: null, refetch: vi.fn() }
})

const renderPage = () => render(<MemoryRouter><Fixtures /></MemoryRouter>)
// An admin's page also loads the squad list for the result form: let it land.
const settled = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

test('the 1st Team filter selects fixtures stored under the xl key', async () => {
  auth.state = { ...playerAuth, teamKeys: ['xl', 'community'] }
  const games = [fixture('red', 'xl'), fixture('green', 'community')]
  fx.state = { ...fx.state, fixtures: games, upcoming: games, teams: games.map((game) => game.team) }
  renderPage()
  await userEvent.click(screen.getByRole('tab', { name: '1st Team' }))
  expect(screen.getByText('HERO red')).toBeInTheDocument()
  expect(screen.queryByText('STRIP green')).toBeNull()
})

test('a reminder opens the addressed fixture and requests focus on its answer, even when another fixture leads', async () => {
  const games = [fixture('first', 'community'), fixture('second', 'community')]
  fx.state = { ...fx.state, loaded: true, fixtures: games, upcoming: games }
  render(<MemoryRouter initialEntries={['/fixtures?mvf_fixture=second']}><Fixtures /></MemoryRouter>)
  await waitFor(() => expect(detailProps.last?.fixture?.id).toBe('second'))
  expect(detailProps.last.focusAnswer).toBe(true)
})

test.each([
  ['&mvf_avail=in', 'me', true],
  ['&view=lineup', 'line', false],
])('a reminder with %s opens for viewing and consumes only its own parameters', async (query, tab, focus) => {
  const games = [fixture('second', 'community')]
  fx.state = { ...fx.state, loaded: true, fixtures: games, upcoming: games }
  function Location() {
    const { search, hash } = useLocation()
    return <output aria-label="Location">{search + hash}</output>
  }
  render(<MemoryRouter initialEntries={['/fixtures?from=club&mvf_fixture=second' + query + '#diary']}>
    <Fixtures /><Location />
  </MemoryRouter>)
  await waitFor(() => expect(detailProps.last?.fixture?.id).toBe('second'))
  expect(detailProps.last.initialTab).toBe(tab)
  expect(detailProps.last.focusAnswer).toBe(focus)
  expect(screen.getByLabelText('Location')).toHaveTextContent('?from=club#diary')
  expect(saveFixtureAnswer).not.toHaveBeenCalled()
})

describe('Fixtures — no phantom "sign you off" banner before the profile has loaded', () => {
  test('profile=null (still loading) shows no account banner', () => {
    auth.state = { ...playerAuth, profile: null, canRespond: false, accountStatus: 'active', respondBlockFor: () => 'unknown' }
    renderPage()
    expect(screen.queryByText(/awaiting manager approval/i)).toBeNull()
  })

  test('a genuinely pending player still gets the banner', () => {
    auth.state = { ...playerAuth, profile: { id: 'u1', approved: false }, canRespond: false, accountStatus: 'pending' }
    renderPage()
    expect(screen.getByText(/awaiting manager approval/i)).toBeInTheDocument()
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

// A season with no fixtures yet is exactly when the manager is adding them. The
// page used "loading && no fixtures" to mean "first load", so every refetch
// (returning to the app refetches) swapped it for the Loader and unmounted the
// open Add-a-fixture form; it came back blank.
describe('Fixtures — an empty season does not go back to the Loader on a refetch', () => {
  const adminAuth = { ...playerAuth, isAdmin: true, profile: { id: 'u1', role: 'admin', approved: true, active: true, is_player: true } }

  test('refetching with the load already done once: the page (and its Add button) stays', async () => {
    auth.state = adminAuth
    fx.state = { ...fx.state, loading: true, loaded: true }
    renderPage()
    await settled()
    expect(screen.getByRole('button', { name: 'Add a fixture' })).toBeInTheDocument()
    expect(screen.queryByText(/loading fixtures/i)).toBeNull()
  })

  test('a refetch that fails leaves the page up too, not the full-screen error', async () => {
    auth.state = adminAuth
    fx.state = { ...fx.state, loaded: true, error: { message: 'Load failed' } }
    renderPage()
    await settled()
    expect(screen.getByRole('button', { name: 'Add a fixture' })).toBeInTheDocument()
    expect(screen.queryByText(/couldn't load fixtures/i)).toBeNull()
    // ...but it does not pass the stale page off as fresh.
    expect(screen.getByRole('status')).toHaveTextContent(/couldn't refresh/i)
  })

  test('the very first load still gets the Loader, and a first load that fails still says so', () => {
    fx.state = { ...fx.state, loading: true, loaded: false }
    const first = renderPage()
    expect(screen.getByText(/loading fixtures/i)).toBeInTheDocument()
    first.unmount()

    fx.state = { ...fx.state, loading: false, loaded: false, error: { message: 'Load failed' } }
    renderPage()
    expect(screen.getByText(/couldn't load fixtures/i)).toBeInTheDocument()
  })
})

describe("Fixtures — the hero is the viewer's next game", () => {
  const ft1 = fixture('ft1', 'xl'), co1 = fixture('co1', 'community'), ft2 = fixture('ft2', 'xl')
  const communityOnly = (f) => (f?.team?.key === 'xl' ? 'other-team' : null)

  test('a Community-only player with a First Team game first: the hero is his own game', () => {
    fx.state = { ...fx.state, upcoming: [ft1, co1, ft2], fixtures: [ft1, co1, ft2] }
    auth.state = { ...playerAuth, respondBlockFor: communityOnly }
    renderPage()
    expect(screen.getByText(/HERO co1/)).toBeInTheDocument()
    // The games he can only watch are still listed, in date order, and not twice.
    expect(screen.getAllByText(/STRIP /).map((n) => n.textContent)).toEqual(['STRIP ft1', 'STRIP ft2'])
  })

  test("the manager still leads with the club's next game", async () => {
    fx.state = { ...fx.state, upcoming: [ft1, co1], fixtures: [ft1, co1] }
    auth.state = { ...playerAuth, isAdmin: true, respondBlockFor: communityOnly }
    renderPage()
    await settled()
    expect(screen.getByText(/HERO ft1/)).toBeInTheDocument()
  })
})

describe('Fixtures — logging a result needs the squad list (stats key by profile_id)', () => {
  const adminAuth = { ...playerAuth, isAdmin: true, profile: { id: 'u1', role: 'admin', approved: true, active: true, is_player: true } }

  test('a failed squad fetch blocks the result form with a visible reason, and a retry that succeeds opens it', async () => {
    const f = fixture('f1', 'xl', { match_date: '2020-01-05' }) // kicked off, so the button is offered
    fx.state = { ...fx.state, upcoming: [f], fixtures: [f] }
    auth.state = adminAuth
    db.error = { message: 'Load failed' }
    renderPage()
    await userEvent.click(screen.getByText('OPEN-DETAIL'))
    await userEvent.click(screen.getByText('LOG-RESULT'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't load squad/i)
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

// The calendar lists already-played games. "Log the result" there used to open
// a BLANK form (the fixtures row carries no result or goals), and saving it
// overwrote the score, half-time and MOTM and deleted every goal.
describe('Fixtures — a game that already has a result cannot be logged again from here', () => {
  const adminAuth = { ...playerAuth, isAdmin: true, profile: { id: 'u1', role: 'admin', approved: true, active: true, is_player: true } }

  async function openFromCalendar(f) {
    fx.state = { ...fx.state, fixtures: [f] }
    auth.state = adminAuth
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Calendar' }))
    await userEvent.click(screen.getByText('CAL ' + f.id))
  }

  test('played and logged: the sheet opens but offers no "Log the result"', async () => {
    await openFromCalendar(fixture('done', 'xl', { match_date: '2020-01-05', hasResult: true, concluded: true }))
    expect(screen.getByText('DETAIL-OPEN')).toBeInTheDocument()
    expect(screen.queryByText('LOG-RESULT')).toBeNull()
  })

  test('postponed and past its old slot: there is no result to log', async () => {
    await openFromCalendar(fixture('pp', 'xl', { match_date: '2020-01-05', status: 'postponed', postponed: true, concluded: true }))
    expect(screen.getByText('DETAIL-OPEN')).toBeInTheDocument()
    expect(screen.queryByText('LOG-RESULT')).toBeNull()
  })

  test('played and NOT logged: the button is still there', async () => {
    await openFromCalendar(fixture('todo', 'xl', { match_date: '2020-01-05', hasResult: false, concluded: true }))
    expect(screen.getByText('LOG-RESULT')).toBeInTheDocument()
  })
})
