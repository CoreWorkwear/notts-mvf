import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Regression for the prod crash: Results used <Stagger>/<StaggerItem> for the
// "earlier results" list but didn't import them — so as soon as there was MORE
// THAN ONE played result, the page threw `Stagger is not defined`. This renders
// that exact branch (two played games) and asserts it doesn't blow up.

const played = [
  { id: 'f1', match_date: '2026-05-10', fixture_type: 'League', home_away: 'Home', team: { key: 'xl', label: 'First Team' }, opponent: { name: 'Carlton' }, result: { us: 3, them: 1, ht_us: 1, ht_them: 0 } },
  { id: 'f3', match_date: '2026-05-06', fixture_type: 'Cup', home_away: 'Home', team: { key: 'xl', label: 'First Team' }, opponent: { name: 'Arnold' }, result: { us: 4, them: 1, ht_us: 2, ht_them: 0 } },
  { id: 'f2', match_date: '2026-05-03', fixture_type: 'League', home_away: 'Away', team: { key: 'community', label: 'Community' }, opponent: { name: 'Mansfield' }, result: { us: 0, them: 2, ht_us: 0, ht_them: 1 } },
]

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ isAdmin: false }) }))
const season = vi.hoisted(() => ({ seasonId: 's1', refreshSeasons: vi.fn() }))
vi.mock('../context/SeasonContext', () => ({ useSeason: () => season }))
vi.mock('../hooks/useResults', () => ({
  useResults: () => ({ played: season.seasonId ? played : [], needsResult: [], postponed: [], squad: [], loading: false, refetch: vi.fn() }),
  outcome: (r) => (r.us > r.them ? 'W' : r.us < r.them ? 'L' : 'D'),
}))
vi.mock('../hooks/useMedia', () => ({ usePhotoPool: () => [] }))
vi.mock('../lib/media', () => ({ heroBackground: () => 'none' }))
vi.mock('../components/ScoreBug', () => ({ default: () => null }))
vi.mock('../components/MatchCentre', () => ({ default: () => null }))
vi.mock('../components/ResultForm', () => ({ default: () => null }))

import Results from './Results'

describe('Results page', () => {
  test('a failed season read offers a season retry before claiming no games have been played', async () => {
    season.seasonId = null; season.error = Error('offline')
    try {
      render(<Results />)
      expect(screen.queryByText('No games played yet')).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
      expect(season.refreshSeasons).toHaveBeenCalled()
    } finally { season.seasonId = 's1'; season.error = null }
  })
  test('renders the earlier-results list (Stagger) without crashing when >1 game is played', () => {
    render(<Results />)
    // The earlier strip (the 2nd played game) renders inside <Stagger>/<StaggerItem>
    // — the branch that threw `Stagger is not defined` before the import was added.
    expect(screen.getByText('Mansfield v Community')).toBeInTheDocument()
  })

  // An away 0–2 defeat used to read "Mansfield v Community 0–2": the label says
  // Mansfield first, the score said us first, so it looked like a win.
  test('an earlier result prints its score in the same order as its matchup', () => {
    render(<Results />)
    const away = screen.getByText('Mansfield v Community').closest('button')
    expect(away).toHaveTextContent('2–0')
    expect(away).toHaveTextContent('L')
    const home = screen.getByText('1st Team v Arnold').closest('button')
    expect(home).toHaveTextContent('4–1')
  })
})

describe('Results — half time on the latest result', () => {
  test('shown when it was recorded', () => {
    render(<Results />)
    expect(screen.getByText(/HT 1–0/)).toBeInTheDocument()
  })

  test('left off when it was not, rather than "HT 0–0" or "HT –"', () => {
    const kept = played[0].result
    played[0].result = { us: 3, them: 1, ht_us: null, ht_them: null }
    try {
      render(<Results />)
      expect(screen.queryByText(/HT/)).toBeNull()
      expect(screen.getByRole('button', { name: /match centre/i })).toBeInTheDocument()
    } finally { played[0].result = kept }
  })
})
