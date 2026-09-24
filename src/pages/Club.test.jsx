import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Club page. It already had an error+retry state for a failed FIRST load, but:
// (1) `if (loading) return <Loader/>` came first, so every refetch (e.g. after
// the league table is edited) swapped the whole page for the Loader — the
// panel and any open sheet unmounted; (2) a failed refresh with data on screen
// said nothing at all.

const state = vi.hoisted(() => ({ table: [], teams: [], stats: {}, loading: false, error: null, refetch: null }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ club: { name: 'Notts MvF' } }) }))
vi.mock('../context/SeasonContext', () => ({ useSeason: () => ({ seasonId: 's1' }) }))
vi.mock('../hooks/useClub', () => ({ useClub: () => ({ ...state }) }))
vi.mock('../hooks/useCompetitions', () => ({ useCompetitions: () => ({ competitions: [] }) }))
vi.mock('../components/LeagueTablePanel', () => ({ default: () => <div>LEAGUE TABLE PANEL</div> }))
vi.mock('../components/StatsPanel', () => ({ default: () => null }))
vi.mock('../components/SquadList', () => ({ default: () => null }))
vi.mock('../components/SponsorsList', () => ({ default: () => null }))

import Club from './Club'

const ROW = { id: 'r1', team_name: 'Notts MvF', played: 1 }
const TEAM = { id: 't-xl', key: 'xl', label: 'First Team' }

beforeEach(() => {
  state.table = []
  state.teams = []
  state.stats = {}
  state.loading = false
  state.error = null
  state.refetch = vi.fn()
})

describe('Club — loading and error states', () => {
  test('a refetch with data already loaded keeps the page mounted (no Loader)', () => {
    state.table = [ROW]
    state.teams = [TEAM]
    state.loading = true
    render(<Club />)
    expect(screen.getByText('LEAGUE TABLE PANEL')).toBeInTheDocument()
  })

  test('a failed refresh keeps the data on screen with a quiet status line', () => {
    state.table = [ROW]
    state.teams = [TEAM]
    state.error = { message: 'boom' }
    render(<Club />)
    expect(screen.getByText('LEAGUE TABLE PANEL')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/couldn't refresh/i)
  })

  test('a failed first load still gets the error + Try again', () => {
    state.error = { message: 'boom' }
    render(<Club />)
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't load the club/i)
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })
})
