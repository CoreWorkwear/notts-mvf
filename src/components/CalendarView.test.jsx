import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CalendarView from './CalendarView'

const XL = { key: 'xl', match_name: 'Nottingham' }
const CO = { key: 'community', match_name: 'Nottingham Community' }
// First Team + Community on the same Sunday — this club's normal weekend.
const first = { id: 'a', match_date: '2031-03-16', kickoff: '14:00:00', team: XL, opponent: { name: 'Boston' }, home_away: 'Home' }
const reserves = { id: 'b', match_date: '2031-03-16', kickoff: '10:30:00', team: CO, opponent: { name: 'Lichfield' }, home_away: 'Away' }
const solo = { id: 'c', match_date: '2031-03-23', kickoff: '14:00:00', team: XL, opponent: { name: 'Carlton' }, home_away: 'Home' }

describe('CalendarView — two games on one day', () => {
  test('both get a dot, in their own team colour', () => {
    render(<CalendarView fixtures={[first, reserves]} onOpen={vi.fn()} />)
    expect(screen.getByText('March 2031')).toBeInTheDocument()
    const cell = screen.getByRole('button', { name: '16' })
    expect(cell.querySelectorAll('.cal-dot')).toHaveLength(2)
    expect(cell.querySelectorAll('.cal-dot.community')).toHaveLength(1)
  })

  test('tapping the day offers both games; either can be opened', async () => {
    const onOpen = vi.fn()
    render(<CalendarView fixtures={[first, reserves, solo]} onOpen={onOpen} />)
    await userEvent.click(screen.getByRole('button', { name: '16' }))
    expect(onOpen).not.toHaveBeenCalled()
    expect(screen.getByText(/2 games/i)).toBeInTheDocument()
    // narrowed to that day — the 23rd's game drops out of the list
    expect(screen.queryByText('Nottingham v Carlton')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('Lichfield v Nottingham Community').closest('button'))
    expect(onOpen).toHaveBeenCalledWith(reserves)

    await userEvent.click(screen.getByRole('button', { name: /whole month/i }))
    expect(screen.getByText('Nottingham v Carlton')).toBeInTheDocument()
  })

  test('a single-game day still opens it straight away', async () => {
    const onOpen = vi.fn()
    render(<CalendarView fixtures={[first, reserves, solo]} onOpen={onOpen} />)
    await userEvent.click(screen.getByRole('button', { name: '23' }))
    expect(onOpen).toHaveBeenCalledWith(solo)
  })
})

describe('CalendarView — opening month', () => {
  test('opens on the month of the next game, not whatever is first in the list', () => {
    const played = { ...first, id: 'old', match_date: '2020-01-05' }
    render(<CalendarView fixtures={[played, solo]} onOpen={vi.fn()} />)
    expect(screen.getByText('March 2031')).toBeInTheDocument()
  })

  test('with nothing coming up, opens on the current month', () => {
    const played = { ...first, id: 'old', match_date: '2020-01-05' }
    render(<CalendarView fixtures={[played]} onOpen={vi.fn()} />)
    const now = new Date()
    const label = now.toLocaleString('en-GB', { month: 'long' }) + ' ' + now.getFullYear()
    expect(screen.getByText(label)).toBeInTheDocument()
  })
})
