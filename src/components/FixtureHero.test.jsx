import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./Crest', () => ({ default: () => null }))
vi.mock('./WeatherStrip', () => ({ default: () => null }))

import FixtureHero from './FixtureHero'

const fixture = {
  id: 'f1', match_date: '2030-12-01', kickoff: '13:00:00', home_away: 'Home', fixture_type: 'League',
  venue: 'Test Park', team: { key: 'xl', label: 'First Team' }, opponent: { name: 'Carlton Town' },
  counts: { in: 7, maybe: 1 }, noReply: 4, myStatus: null,
}

describe('FixtureHero — manager keeps counts + their own availability', () => {
  test('admin sees squad state and a personal In/Maybe/Out', () => {
    render(<FixtureHero fixture={fixture} isAdmin onSetAvail={() => {}} onOpenWhosIn={() => {}} onEdit={() => {}} />)
    expect(screen.getByText(/not replied/i)).toBeInTheDocument()        // counts lead
    expect(screen.getByRole('button', { name: 'In' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Out' })).toBeInTheDocument()
  })

  test('admin tapping their own control sets availability', async () => {
    const onSetAvail = vi.fn().mockResolvedValue()
    render(<FixtureHero fixture={fixture} isAdmin onSetAvail={onSetAvail} onOpenWhosIn={() => {}} onEdit={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Maybe' }))
    expect(onSetAvail).toHaveBeenCalledWith('maybe')
  })

  test('player sees the full availability prompt', () => {
    render(<FixtureHero fixture={fixture} isAdmin={false} onSetAvail={() => {}} onOpenWhosIn={() => {}} onEdit={() => {}} />)
    expect(screen.getByRole('button', { name: "I'm in" })).toBeInTheDocument()
  })
})

// The next-game hero is the one surface a player sees first, so the block has
// to read properly there rather than just hiding the buttons (0034).
describe('FixtureHero — team-scoped availability', () => {
  test('a Community player gets no YOU IN? on a First Team hero', () => {
    render(<FixtureHero fixture={fixture} isAdmin={false} blockReason="other-team" onSetAvail={() => {}} onOpenWhosIn={() => {}} onEdit={() => {}} />)
    expect(screen.queryByRole('button', { name: "I'm in" })).not.toBeInTheDocument()
    expect(screen.queryByText(/YOU IN\?/)).not.toBeInTheDocument()
    expect(screen.getByText(/First Team squad only/i)).toBeInTheDocument()
  })

  test('a manager outside that squad keeps squad state but loses their own control', () => {
    render(<FixtureHero fixture={fixture} isAdmin blockReason="other-team" onSetAvail={() => {}} onOpenWhosIn={() => {}} onEdit={() => {}} />)
    expect(screen.getByText(/not replied/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'In' })).not.toBeInTheDocument()
  })

  test('a pending player still gets the sign-off line, not the squad one', () => {
    render(<FixtureHero fixture={fixture} isAdmin={false} blockReason="pending" onSetAvail={() => {}} onOpenWhosIn={() => {}} onEdit={() => {}} />)
    expect(screen.getByText(/signs you off/i)).toBeInTheDocument()
  })
})
