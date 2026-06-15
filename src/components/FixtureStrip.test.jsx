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
    render(<FixtureStrip fixture={fixture} isAdmin={false} canRespond onSetAvail={() => {}} onOpen={() => {}} />)
    expect(screen.getByRole('button', { name: 'In' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Maybe' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Out' })).toBeInTheDocument()
  })

  test('a manager sees the squad counts AND their own In/Maybe/Out', () => {
    render(<FixtureStrip fixture={fixture} isAdmin canRespond onSetAvail={() => {}} onOpen={() => {}} />)
    expect(screen.getByText('in · maybe · left')).toBeInTheDocument() // counts still there
    expect(screen.getByRole('button', { name: 'In' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Maybe' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Out' })).toBeInTheDocument()
  })

  test('tapping the manager control sets their status', async () => {
    const onSetAvail = vi.fn().mockResolvedValue()
    render(<FixtureStrip fixture={fixture} isAdmin canRespond onSetAvail={onSetAvail} onOpen={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'In' }))
    expect(onSetAvail).toHaveBeenCalledWith('in')
  })

  test('a not-signed-off player gets no options', () => {
    render(<FixtureStrip fixture={fixture} isAdmin={false} canRespond={false} onSetAvail={() => {}} onOpen={() => {}} />)
    expect(screen.queryByRole('button', { name: 'In' })).not.toBeInTheDocument()
    expect(screen.getByText(/not signed off yet/i)).toBeInTheDocument()
  })
})
