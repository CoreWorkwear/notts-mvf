import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Who's In (admin). Two bugs: (1) the page ignored `error` from useFixtures,
// so a failed load read as "No games to chase" — a lie; (2) `upcoming` includes
// postponed fixtures, so a P-P game sat in the chase list as if it needed
// heads counting.

const state = vi.hoisted(() => ({ upcoming: [], fixtures: [], loading: false, error: null, refetch: null }))
vi.mock('../context/SeasonContext', () => ({ useSeason: () => ({ seasonId: 's1' }) }))
vi.mock('../hooks/useFixtures', () => ({ useFixtures: () => ({ ...state }) }))
vi.mock('../lib/teams', () => ({ fixtureMatchup: (f) => `${f.team.label} v ${f.opponent.name}` }))
vi.mock('../components/WhosInSheet', () => ({ default: () => null }))

import AdminAvailability from './AdminAvailability'

const base = { match_date: '2030-12-01', kickoff: '13:00:00', team: { key: 'xl', label: 'First Team' }, counts: { in: 5, maybe: 1, out: 0 }, noReply: 3, postponed: false }

beforeEach(() => {
  state.upcoming = []
  state.fixtures = []
  state.loading = false
  state.error = null
  state.refetch = vi.fn()
})

describe("Who's In — a failed load is not an empty diary", () => {
  test('error + no fixtures → error state with Try again (calls refetch), never "No games to chase"', async () => {
    state.error = { message: 'boom' }
    render(<AdminAvailability />)
    expect(screen.queryByText(/no games to chase/i)).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't pull the fixtures/i)
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(state.refetch).toHaveBeenCalled()
  })

  test('a genuinely empty diary still shows the empty state', () => {
    render(<AdminAvailability />)
    expect(screen.getByText(/no games to chase/i)).toBeInTheDocument()
  })
})

describe("Who's In — postponed games are not chased", () => {
  test('a P-P fixture is left out of the chase list', () => {
    const scheduled = { ...base, id: 'f1', opponent: { name: 'Carlton' } }
    const pp = { ...base, id: 'f2', opponent: { name: 'Mansfield' }, postponed: true, status: 'postponed' }
    state.upcoming = [scheduled, pp]
    state.fixtures = [scheduled, pp]
    render(<AdminAvailability />)
    expect(screen.getByText('First Team v Carlton')).toBeInTheDocument()
    expect(screen.queryByText('First Team v Mansfield')).toBeNull()
  })

  test('only postponed games left → the empty state, not an empty list', () => {
    const pp = { ...base, id: 'f2', opponent: { name: 'Mansfield' }, postponed: true, status: 'postponed' }
    state.upcoming = [pp]
    state.fixtures = [pp]
    render(<AdminAvailability />)
    expect(screen.getByText(/no games to chase/i)).toBeInTheDocument()
  })
})
