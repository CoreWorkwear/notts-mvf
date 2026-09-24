import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const save = vi.fn().mockResolvedValue({ error: null })
const remove = vi.fn().mockResolvedValue({ error: null })
const refetch = vi.fn()
let comps
let mockError = null
// The hook's `loading` is real React state here so a test can flip it the way
// the hook does mid-save (save → await load() → loading=true → false).
const hookState = vi.hoisted(() => ({ setLoading: null }))
vi.mock('../context/SeasonContext', () => ({ useSeason: () => ({ seasonId: 's1', seasons: [{ id: 's1', label: '2026/27' }] }) }))
vi.mock('../hooks/useCompetitions', async () => {
  const React = await import('react')
  return {
    useCompetitions: () => {
      const [loading, setLoading] = React.useState(false)
      hookState.setLoading = setLoading
      return { competitions: comps, loading, error: mockError, save, remove, refetch }
    },
  }
})
vi.mock('../components/SquadPicker', () => ({ default: () => null })) // covered by its own test

import Competitions from './Competitions'

beforeEach(() => { save.mockClear(); refetch.mockClear(); comps = []; mockError = null })

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

// BUG: `if (loading) return <Loader/>` ran on EVERY refetch, not just the first.
// save() → await load() → loading=true → the page swapped to the Loader, the
// open Sheet unmounted, then remounted when loading went false again — pushing
// a stray history entry each time (CLAUDE.md "two things that bite").
describe('Competitions — the sheet survives a refetch', () => {
  test('REGRESSION: the edit sheet stays mounted while a save is pending and loading flips true', async () => {
    comps = [{ id: 'c1', name: 'Sunday League', type: 'league', squad_limit_enabled: false }]
    let resolveSave
    save.mockImplementationOnce(() => new Promise((res) => { resolveSave = res }))
    render(<Competitions />)

    await userEvent.click(screen.getByText('Sunday League'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(save).toHaveBeenCalled())

    // Mid-save the hook's load() sets loading=true. Old code: Loader replaced the page.
    act(() => hookState.setLoading(true))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /saving/i })).toBeInTheDocument()

    await act(async () => { hookState.setLoading(false); resolveSave({ error: null }) })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()) // closed on success, not by a Loader swap
  })
})

// BUG: the hook's `error` was ignored — a failed load read as "No competitions yet".
describe('Competitions — a failed load is not an empty list', () => {
  test('first load failed → error + Try again (calls refetch), no empty state', async () => {
    mockError = { message: 'boom' }
    render(<Competitions />)
    expect(screen.queryByText(/no competitions yet/i)).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't/i)
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(refetch).toHaveBeenCalled()
  })

  test('a failed refresh keeps the competitions on screen with a quiet status line', () => {
    comps = [{ id: 'c1', name: 'Sunday League', type: 'league', squad_limit_enabled: false }]
    mockError = { message: 'boom' }
    render(<Competitions />)
    expect(screen.getByText('Sunday League')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/couldn't refresh/i)
  })
})
