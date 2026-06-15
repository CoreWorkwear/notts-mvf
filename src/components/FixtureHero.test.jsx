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
    render(<FixtureHero fixture={fixture} isAdmin canRespond onSetAvail={() => {}} onOpenWhosIn={() => {}} onEdit={() => {}} />)
    expect(screen.getByText(/not replied/i)).toBeInTheDocument()        // counts lead
    expect(screen.getByRole('button', { name: 'In' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Out' })).toBeInTheDocument()
  })

  test('admin tapping their own control sets availability', async () => {
    const onSetAvail = vi.fn().mockResolvedValue()
    render(<FixtureHero fixture={fixture} isAdmin canRespond onSetAvail={onSetAvail} onOpenWhosIn={() => {}} onEdit={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Maybe' }))
    expect(onSetAvail).toHaveBeenCalledWith('maybe')
  })

  test('player sees the full availability prompt', () => {
    render(<FixtureHero fixture={fixture} isAdmin={false} canRespond onSetAvail={() => {}} onOpenWhosIn={() => {}} onEdit={() => {}} />)
    expect(screen.getByRole('button', { name: "I'm in" })).toBeInTheDocument()
  })
})
