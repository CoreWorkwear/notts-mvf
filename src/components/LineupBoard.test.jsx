import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const save = vi.fn().mockResolvedValue({ error: null })
let mock
vi.mock('../hooks/useLineup', () => ({ useLineup: () => mock }))

import LineupBoard from './LineupBoard'

beforeEach(() => {
  save.mockClear()
  mock = {
    saved: { formation: '4-4-2', starters: {}, subs: [] },
    pool: [{ id: 'p1', name: 'Joe Bloggs', status: 'in' }, { id: 'p2', name: 'Sam Lee', status: 'maybe' }],
    names: { p1: 'Joe Bloggs', p2: 'Sam Lee' },
    hasLineup: false, loading: false, save,
  }
})

describe('LineupBoard', () => {
  test('a player sees an empty-state until the manager picks the side', () => {
    render(<LineupBoard fixture={{ id: 'f1' }} isAdmin={false} open />)
    expect(screen.getByText(/line-up not picked yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pick the line-up/i })).not.toBeInTheDocument()
  })

  test('a manager picks a player into a slot and saves the line-up', async () => {
    render(<LineupBoard fixture={{ id: 'f1' }} isAdmin open />)
    await userEvent.click(screen.getByRole('button', { name: /pick the line-up/i }))

    // tap the GK slot, then pick a player from the available pool
    await userEvent.click(screen.getByText('GK').closest('button'))
    await userEvent.click(screen.getByText('Joe Bloggs').closest('button'))

    await userEvent.click(screen.getByRole('button', { name: /save line-up/i }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    const rows = save.mock.calls[0][0]
    expect(rows).toContainEqual(expect.objectContaining({ fixture_id: 'f1', profile_id: 'p1', role: 'start', position: 'GK', slot: 0, formation: '4-4-2' }))
  })

  test('only available (in/maybe) players are offered', async () => {
    render(<LineupBoard fixture={{ id: 'f1' }} isAdmin open />)
    await userEvent.click(screen.getByRole('button', { name: /pick the line-up/i }))
    await userEvent.click(screen.getByText('GK').closest('button'))
    expect(screen.getByText('Joe Bloggs')).toBeInTheDocument()
    expect(screen.getByText('Sam Lee')).toBeInTheDocument()
  })
})
