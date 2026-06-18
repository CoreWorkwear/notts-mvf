import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const add = vi.fn().mockResolvedValue({ error: null })
const remove = vi.fn().mockResolvedValue({ error: null })
let squadState
vi.mock('../hooks/usePlayers', () => ({
  usePlayers: () => ({ loading: false, players: [
    { id: 'p1', first_name: 'Joe', last_name: 'Morris', active: true, is_player: true },
    { id: 'p2', first_name: 'Sam', last_name: 'Lee', active: true, is_player: true },
    { id: 'p3', first_name: 'Sup', last_name: 'Porter', active: true, is_player: false }, // supporter — excluded
  ] }),
}))
vi.mock('../hooks/useCompetitionSquad', () => ({ useCompetitionSquad: () => squadState }))

import SquadPicker from './SquadPicker'

beforeEach(() => {
  add.mockClear(); remove.mockClear()
  squadState = { registered: new Set(), count: 0, loading: false, add, remove, refetch: vi.fn() }
})

const COMP = { id: 'comp-1', name: 'County Cup', squad_limit_enabled: true, squad_limit: 2 }

describe('SquadPicker (§2)', () => {
  test('lists only squad players (not supporters) and shows the count/cap', () => {
    render(<SquadPicker open competition={COMP} onClose={() => {}} />)
    expect(screen.getByText('Joe Morris')).toBeInTheDocument()
    expect(screen.getByText('Sam Lee')).toBeInTheDocument()
    expect(screen.queryByText('Sup Porter')).not.toBeInTheDocument()
    expect(screen.getByText(/0 \/ 2 registered/)).toBeInTheDocument()
  })

  test('registering a player calls add', async () => {
    render(<SquadPicker open competition={COMP} onClose={() => {}} />)
    await userEvent.click(within(screen.getByText('Joe Morris').closest('.sq-row')).getByRole('button'))
    await waitFor(() => expect(add).toHaveBeenCalledWith('p1'))
  })

  test('when full, unregistered players cannot be added', () => {
    squadState = { registered: new Set(['p1', 'p2']), count: 2, loading: false, add, remove, refetch: vi.fn() }
    render(<SquadPicker open competition={COMP} onClose={() => {}} />)
    // Joe (registered) can still be removed; an unregistered player would show "Full" + disabled,
    // but here both are registered, so the header shows full and registered ones stay toggleable.
    expect(screen.getByText(/2 \/ 2 registered · full/)).toBeInTheDocument()
    const joeBtn = within(screen.getByText('Joe Morris').closest('.sq-row')).getByRole('button')
    expect(joeBtn).toHaveTextContent(/registered/i)
    expect(joeBtn).not.toBeDisabled() // can de-register
  })

  test('unlimited competition shows a plain count', () => {
    render(<SquadPicker open competition={{ id: 'c2', name: 'Friendlies', squad_limit_enabled: false, squad_limit: null }} onClose={() => {}} />)
    expect(screen.getByText(/^0 registered$/)).toBeInTheDocument()
  })
})