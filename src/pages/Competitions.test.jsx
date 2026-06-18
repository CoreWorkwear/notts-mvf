import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const save = vi.fn().mockResolvedValue({ error: null })
const remove = vi.fn().mockResolvedValue({ error: null })
let comps
vi.mock('../context/SeasonContext', () => ({ useSeason: () => ({ seasonId: 's1', seasons: [{ id: 's1', label: '2026/27' }] }) }))
vi.mock('../hooks/useCompetitions', () => ({ useCompetitions: () => ({ competitions: comps, loading: false, save, remove }) }))

import Competitions from './Competitions'

beforeEach(() => { save.mockClear(); comps = [] })

describe('Competitions admin', () => {
  test('empty state, then add a capped competition', async () => {
    render(<Competitions />)
    expect(screen.getByText(/no competitions yet/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /add a competition/i }))
    await userEvent.type(screen.getByLabelText('Name'), 'County Cup')
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'cup')
    await userEvent.click(screen.getByRole('button', { name: /capped squad/i }))
    await userEvent.type(screen.getByLabelText('Squad size'), '16')
    await userEvent.click(screen.getByRole('button', { name: /add competition/i }))

    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][0]).toMatchObject({ name: 'County Cup', type: 'cup', squad_limit_enabled: true, squad_limit: '16' })
  })

  test('blocks a capped competition with no size', async () => {
    render(<Competitions />)
    await userEvent.click(screen.getByRole('button', { name: /add a competition/i }))
    await userEvent.type(screen.getByLabelText('Name'), 'No Size League')
    await userEvent.click(screen.getByRole('button', { name: /capped squad/i }))
    await userEvent.click(screen.getByRole('button', { name: /add competition/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/squad size/i)
    expect(save).not.toHaveBeenCalled()
  })

  test('lists competitions with their squad rule', () => {
    comps = [{ id: 'c1', name: 'Sunday League', type: 'league', squad_limit_enabled: false }]
    render(<Competitions />)
    expect(screen.getByText('Sunday League')).toBeInTheDocument()
    expect(screen.getByText(/League · No squad limit/)).toBeInTheDocument()
  })
})
