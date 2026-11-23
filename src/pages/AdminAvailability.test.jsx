import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Who's In (admin). Two bugs: (1) the page ignored `error` from useFixtures,
// so a failed load read as "No upcoming fixtures" — a lie; (2) `upcoming` includes
// postponed fixtures, so a P-P game sat in the chase list as if it needed
// heads counting.

const state = vi.hoisted(() => ({ upcoming: [], fixtures: [], loading: false, error: null, refetch: null }))
const season = vi.hoisted(() => ({ seasonId: 's1', refreshSeasons: vi.fn() }))
vi.mock('../context/SeasonContext', () => ({ useSeason: () => season }))
vi.mock('../hooks/useFixtures', () => ({ useFixtures: () => ({ ...state }) }))
vi.mock('../components/WhosInSheet', () => ({ default: ({ open, fixture }) => (open ? <div>SHEET {fixture.id}</div> : null) }))

import AdminAvailability from './AdminAvailability'

const base = { match_date: '2030-12-01', kickoff: '13:00:00', home_away: 'Home', team: { key: 'xl', label: 'First Team' }, counts: { in: 5, maybe: 1, out: 0 }, noReply: 3, postponed: false }

beforeEach(() => {
  season.seasonId = 's1'; season.error = null
  state.upcoming = []
  state.fixtures = []
  state.loading = false
  state.error = null
  state.refetch = vi.fn()
})

describe("Who's In — a failed load is not an empty diary", () => {
  test('a failed season read offers a season retry', async () => {
    season.seasonId = null; season.error = Error('offline')
    render(<AdminAvailability />)
    expect(screen.queryByText(/no upcoming fixtures/i)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(season.refreshSeasons).toHaveBeenCalled()
  })
  test('error + no fixtures → error state with Try again (calls refetch), never "No upcoming fixtures"', async () => {
    state.error = { message: 'boom' }
    render(<AdminAvailability />)
    expect(screen.queryByText(/no upcoming fixtures/i)).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't load fixtures/i)
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(state.refetch).toHaveBeenCalled()
  })

  test('a genuinely empty diary still shows the empty state', () => {
    render(<AdminAvailability />)
    expect(screen.getByText(/no upcoming fixtures/i)).toBeInTheDocument()
  })
})

describe("Who's In — postponed games are not chased", () => {
  test('a P-P fixture is left out of the chase list', () => {
    const scheduled = { ...base, id: 'f1', opponent: { name: 'Carlton' } }
    const pp = { ...base, id: 'f2', opponent: { name: 'Mansfield' }, postponed: true, status: 'postponed' }
    state.upcoming = [scheduled, pp]
    state.fixtures = [scheduled, pp]
    render(<AdminAvailability />)
    expect(screen.getByText('1st Team v Carlton')).toBeInTheDocument()
    expect(screen.queryByText('1st Team v Mansfield')).toBeNull()
  })

  test('only postponed games left → the empty state, not an empty list', () => {
    const pp = { ...base, id: 'f2', opponent: { name: 'Mansfield' }, postponed: true, status: 'postponed' }
    state.upcoming = [pp]
    state.fixtures = [pp]
    render(<AdminAvailability />)
    expect(screen.getByText(/no upcoming fixtures/i)).toBeInTheDocument()
  })
})

// The subs tick-list and the CSV live in the Who's In sheet, and the sheet was
// only reachable from the UPCOMING list. A game leaves that list the moment its
// result is logged (or at kickoff + 4h), so on Sunday night the manager could
// no longer mark who had paid for that day's game, or export it.
describe("Who's In — a game just played can still be opened for its subs", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2030-12-10T12:00:00Z')) })
  afterEach(() => { vi.useRealTimers() })

  const played = (id, date, over = {}) => ({ ...base, id, match_date: date, opponent: { name: 'Opp ' + id }, concluded: true, hasResult: true, ...over })

  test('played in the last fortnight: listed under Recently played, newest first, and opens its sheet', async () => {
    const next = { ...base, id: 'up', match_date: '2030-12-15', opponent: { name: 'Carlton' } }
    const sun = played('sun', '2030-12-08'), prev = played('prev', '2030-12-01')
    state.upcoming = [next]
    state.fixtures = [prev, sun, next]
    render(<AdminAvailability />)

    expect(screen.getByText(/recently played/i)).toBeInTheDocument()
    expect(screen.getAllByText(/1st Team v Opp/).map((n) => n.textContent)).toEqual(['1st Team v Opp sun', '1st Team v Opp prev'])

    await userEvent.click(screen.getByText('1st Team v Opp sun'))
    expect(screen.getByText('SHEET sun')).toBeInTheDocument()
  })

  test('awaiting a result counts as played; older than a fortnight and postponed games do not show', () => {
    state.fixtures = [
      played('noresult', '2030-12-08', { hasResult: false }),
      played('old', '2030-11-20'),
      played('pp', '2030-12-08', { hasResult: false, postponed: true }),
    ]
    render(<AdminAvailability />)
    expect(screen.getByText('1st Team v Opp noresult')).toBeInTheDocument()
    expect(screen.queryByText('1st Team v Opp old')).toBeNull()
    expect(screen.queryByText('1st Team v Opp pp')).toBeNull()
  })

  test('nothing to chase but a game to settle: both the empty line and the played game show', () => {
    state.fixtures = [played('sun', '2030-12-08')]
    render(<AdminAvailability />)
    expect(screen.getByText(/no upcoming fixtures/i)).toBeInTheDocument()
    expect(screen.getByText('1st Team v Opp sun')).toBeInTheDocument()
  })

  test('nothing played lately: no Recently played heading', () => {
    state.upcoming = [{ ...base, id: 'up', opponent: { name: 'Carlton' } }]
    state.fixtures = state.upcoming
    render(<AdminAvailability />)
    expect(screen.queryByText(/recently played/i)).toBeNull()
  })
})
