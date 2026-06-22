import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Regression for the prod crash: Results used <Stagger>/<StaggerItem> for the
// "earlier results" list but didn't import them — so as soon as there was MORE
// THAN ONE played result, the page threw `Stagger is not defined`. This renders
// that exact branch (two played games) and asserts it doesn't blow up.

const played = [
  { id: 'f1', match_date: '2026-05-10', fixture_type: 'League', team: { key: 'xl', label: 'First Team' }, opponent: { name: 'Carlton' }, result: { us: 3, them: 1, ht_us: 1, ht_them: 0 } },
  { id: 'f2', match_date: '2026-05-03', fixture_type: 'League', team: { key: 'community', label: 'Community' }, opponent: { name: 'Mansfield' }, result: { us: 0, them: 2, ht_us: 0, ht_them: 1 } },
]

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ isAdmin: false }) }))
vi.mock('../context/SeasonContext', () => ({ useSeason: () => ({ seasonId: 's1' }) }))
vi.mock('../hooks/useResults', () => ({
  useResults: () => ({ played, needsResult: [], postponed: [], squad: [], loading: false, refetch: vi.fn() }),
  outcome: (r) => (r.us > r.them ? 'W' : r.us < r.them ? 'L' : 'D'),
}))
vi.mock('../hooks/useMedia', () => ({ usePhotoPool: () => [] }))
vi.mock('../lib/media', () => ({ heroBackground: () => 'none' }))
vi.mock('../lib/teams', () => ({ fixtureMatchup: (f) => `${f.team.label} v ${f.opponent.name}` }))
vi.mock('../components/ScoreBug', () => ({ default: () => null }))
vi.mock('../components/MatchCentre', () => ({ default: () => null }))
vi.mock('../components/ResultForm', () => ({ default: () => null }))

import Results from './Results'

describe('Results page', () => {
  test('renders the earlier-results list (Stagger) without crashing when >1 game is played', () => {
    render(<Results />)
    // The earlier strip (the 2nd played game) renders inside <Stagger>/<StaggerItem>
    // — the branch that threw `Stagger is not defined` before the import was added.
    expect(screen.getByText('Community v Mansfield')).toBeInTheDocument()
    expect(screen.getByText('0–2')).toBeInTheDocument() // earlier strip score
  })
})
