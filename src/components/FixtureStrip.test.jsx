import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FixtureStrip from './FixtureStrip'

// match_date far in the future → WeatherStrip is outside its window and never fetches.
const fixture = {
  id: 'f1', match_date: '2030-12-01', kickoff: '13:00:00', home_away: 'Home', fixture_type: 'League',
  venue: 'Test Park', team: { key: 'community', label: 'Community' }, opponent: { name: 'Long Eaton' },
  counts: { in: 5, maybe: 2 }, noReply: 3, myStatus: null,
}

describe('FixtureStrip availability', () => {
  test('a player gets all three options on the list row', () => {
    render(<FixtureStrip fixture={fixture} isAdmin={false} onSetAvail={() => {}} onOpen={() => {}} />)
    expect(screen.getByRole('button', { name: 'In' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Maybe' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Out' })).toBeInTheDocument()
  })

  test('a manager sees the squad counts AND their own In/Maybe/Out', () => {
    render(<FixtureStrip fixture={fixture} isAdmin onSetAvail={() => {}} onOpen={() => {}} />)
    // Each figure now carries its own caption, so assert the PAIRING rather
    // than one caption string — that is what was misaligned before.
    const counts = screen.getByRole('button', { name: /see who's in/i })
    expect(counts).toHaveTextContent(/5\s*in/i)
    expect(counts).toHaveTextContent(/2\s*maybe/i)
    expect(counts).toHaveTextContent(/3\s*no reply/i)
    expect(screen.getByRole('button', { name: 'In' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Maybe' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Out' })).toBeInTheDocument()
  })

  test('tapping the manager control sets their status', async () => {
    const onSetAvail = vi.fn().mockResolvedValue()
    render(<FixtureStrip fixture={fixture} isAdmin onSetAvail={onSetAvail} onOpen={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'In' }))
    expect(onSetAvail).toHaveBeenCalledWith('in')
  })

  test('a not-signed-off player gets no options', () => {
    render(<FixtureStrip fixture={fixture} isAdmin={false} blockReason="pending" onSetAvail={() => {}} onOpen={() => {}} />)
    expect(screen.queryByRole('button', { name: 'In' })).not.toBeInTheDocument()
    expect(screen.getByText(/not signed off yet/i)).toBeInTheDocument()
  })
})

// The reported bug, at the row that shows it: a Community player looking at a
// First Team game must not get In/Maybe/Out (0034).
describe('FixtureStrip — team-scoped availability', () => {
  const xlFixture = { ...fixture, team: { key: 'xl', label: 'First Team' } }

  test('a player outside the squad gets no options, and is told whose game it is', () => {
    render(<FixtureStrip fixture={xlFixture} isAdmin={false} blockReason="other-team" onSetAvail={() => {}} onOpen={() => {}} />)
    expect(screen.queryByRole('button', { name: 'In' })).not.toBeInTheDocument()
    expect(screen.getByText(/first team squad only/i)).toBeInTheDocument()
  })

  test('a manager outside the squad keeps the counts but loses their own control', () => {
    render(<FixtureStrip fixture={xlFixture} isAdmin blockReason="other-team" onSetAvail={() => {}} onOpen={() => {}} />)
    expect(screen.getByRole('button', { name: /see who's in/i })).toHaveTextContent(/5\s*in/i)
    expect(screen.queryByRole('button', { name: 'In' })).not.toBeInTheDocument()
  })

  test('a game that has kicked off is closed', () => {
    render(<FixtureStrip fixture={fixture} isAdmin={false} blockReason="kicked-off" onSetAvail={() => {}} onOpen={() => {}} />)
    expect(screen.queryByRole('button', { name: 'In' })).not.toBeInTheDocument()
    expect(screen.getByText(/kicked off/i)).toBeInTheDocument()
  })
})
