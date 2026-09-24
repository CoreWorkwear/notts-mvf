import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// WeatherStrip does a network fetch — stub it out for a quiet unit test.
vi.mock('./WeatherStrip', () => ({ default: () => null }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
// Table-aware, but .eq() is not re-implemented — team_memberships holds only
// the rows the real `.eq('team_id', fixture.team_id)` would have returned.
const store = vi.hoisted(() => ({ tables: {} }))
vi.mock('../lib/supabase', () => {
  const make = (table) => {
    const q = { then: (r) => Promise.resolve({ data: store.tables[table] ?? [], error: null }).then(r) }
    ;['select', 'eq'].forEach((m) => { q[m] = () => q })
    return q
  }
  return { supabase: { from: make } }
})

import FixtureDetail from './FixtureDetail'

beforeEach(() => { store.tables = {} })

const fx = {
  id: 'f1', myStatus: 'out', team_id: 't-first',
  team: { key: 'xl', label: 'First Team', match_name: 'Nottingham' },
  opponent: { name: 'Boston' }, home_away: 'Home', fixture_type: 'League',
  match_date: '2030-12-01', kickoff: '14:00:00', venue: 'X',
}

describe('FixtureDetail — §2.2 availability reflects immediately', () => {
  test('picking In updates the displayed selection without reopening the sheet', async () => {
    const onSetAvail = vi.fn().mockResolvedValue()
    render(<FixtureDetail open fixture={fx} isAdmin={false} onSetAvail={onSetAvail} onClose={() => {}} />)

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
    render(<FixtureDetail open fixture={fx} isAdmin={false} onSetAvail={vi.fn()} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: "I'm in" })).toBeVisible()
    expect(screen.getByRole('button', { name: /^maybe$/i })).toBeVisible()
    expect(screen.getByRole('button', { name: /can't make it/i })).toBeVisible()
  })
})

// This sheet is also how the Calendar opens a game, so it is the one surface
// that can be pointed at a fixture already played — and at a fixture belonging
// to a squad the viewer isn't in (0034).
describe('FixtureDetail — team-scoped availability', () => {
  test('a player outside the squad gets no options on the Availability tab', () => {
    render(<FixtureDetail open fixture={fx} isAdmin={false} blockReason="other-team" onSetAvail={vi.fn()} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: "I'm in" })).not.toBeInTheDocument()
    expect(screen.getByText(/First Team squad only/i)).toBeInTheDocument()
  })

  test('a game that has kicked off is closed, whichever way it was opened', () => {
    render(<FixtureDetail open fixture={fx} isAdmin={false} blockReason="kicked-off" onSetAvail={vi.fn()} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: "I'm in" })).not.toBeInTheDocument()
    expect(screen.getByText(/shut at kickoff/i)).toBeInTheDocument()
  })

  test("the Who's in tab lists this squad's answers only", async () => {
    store.tables = {
      availability: [
        { status: 'in', profile: { id: 'p-in', first_name: 'Joe', last_name: 'Morris' } },
        { status: 'in', profile: { id: 'p-sup', first_name: 'Sue', last_name: 'Supporter' } },
        { status: 'maybe', profile: { id: 'p-pend', first_name: 'Pat', last_name: 'Pending' } },
        { status: 'out', profile: { id: 'p-gone', first_name: 'Ollie', last_name: 'Old' } },
      ],
      team_memberships: [
        { profiles: { id: 'p-in', active: true, approved: true, is_player: true } },
        { profiles: { id: 'p-sup', active: true, approved: true, is_player: false } },
        { profiles: { id: 'p-pend', active: true, approved: false, is_player: true } },
        { profiles: { id: 'p-gone', active: false, approved: true, is_player: true } },
      ],
    }
    render(<FixtureDetail open fixture={fx} isAdmin={false} onSetAvail={vi.fn()} onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: "Who's in" }))

    await waitFor(() => expect(screen.getByText(/Available · 1/)).toBeInTheDocument())
    expect(screen.getByText('Joe M')).toBeInTheDocument()
    expect(screen.getByText(/Maybe · 0/)).toBeInTheDocument()
    expect(screen.getByText(/Can't make it · 0/)).toBeInTheDocument()
    expect(screen.queryByText('Sue S')).not.toBeInTheDocument()
    expect(screen.queryByText('Pat P')).not.toBeInTheDocument()
    expect(screen.queryByText('Ollie O')).not.toBeInTheDocument()
  })
})
