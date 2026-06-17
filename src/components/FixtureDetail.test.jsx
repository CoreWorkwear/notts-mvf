import { describe, test, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// WeatherStrip does a network fetch — stub it out for a quiet unit test.
vi.mock('./WeatherStrip', () => ({ default: () => null }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../lib/supabase', () => {
  const q = { select: () => q, eq: () => q, then: (r) => Promise.resolve({ data: [], error: null }).then(r) }
  return { supabase: { from: () => q } }
})

import FixtureDetail from './FixtureDetail'

const fx = {
  id: 'f1', myStatus: 'out',
  team: { key: 'xl', label: 'First Team', match_name: 'Nottingham' },
  opponent: { name: 'Boston' }, home_away: 'Home', fixture_type: 'League',
  match_date: '2030-12-01', kickoff: '14:00:00', venue: 'X',
}

describe('FixtureDetail — §2.2 availability reflects immediately', () => {
  test('picking In updates the displayed selection without reopening the sheet', async () => {
    const onSetAvail = vi.fn().mockResolvedValue()
    render(<FixtureDetail open fixture={fx} isAdmin={false} canRespond onSetAvail={onSetAvail} onClose={() => {}} />)

    const inBtn = screen.getByRole('button', { name: "I'm in" })
    expect(inBtn).toHaveAttribute('aria-pressed', 'false') // starts on "out"

    await userEvent.click(inBtn)
    expect(onSetAvail).toHaveBeenCalledWith('in')
    // The DISPLAYED state must move to In immediately (the bug: it stayed on the
    // stale snapshot until the sheet was reopened).
    await waitFor(() => expect(inBtn).toHaveAttribute('aria-pressed', 'true'))
  })

  // §2.3 regression — all three availability options must be present + selectable
  // on the drill-down (they'd gone missing here before).
  test('shows all three availability options', () => {
    render(<FixtureDetail open fixture={fx} isAdmin={false} canRespond onSetAvail={vi.fn()} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: "I'm in" })).toBeVisible()
    expect(screen.getByRole('button', { name: /^maybe$/i })).toBeVisible()
    expect(screen.getByRole('button', { name: /can't make it/i })).toBeVisible()
  })
})
