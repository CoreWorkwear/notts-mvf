import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const save = vi.fn().mockResolvedValue({ error: null })
const invoke = vi.hoisted(() => vi.fn())
let mock
vi.mock('../hooks/useLineup', () => ({ useLineup: () => mock }))
vi.mock('../lib/supabase', () => ({ supabase: { functions: { invoke } } }))

import LineupBoard from './LineupBoard'

beforeEach(() => {
  save.mockClear(); invoke.mockReset(); invoke.mockResolvedValue({ data: { sent: 3 }, error: null })
  mock = {
    saved: { formation: '4-4-2', starters: {}, subs: [] },
    pool: [{ id: 'p1', name: 'Joe Bloggs', status: 'in' }, { id: 'p2', name: 'Sam Lee', status: 'maybe' }],
    names: { p1: 'Joe Bloggs', p2: 'Sam Lee' },
    hasLineup: false, loading: false, save,
  }
})

// A failed load leaves the hook with an empty line-up and hasLineup=false —
// exactly what "nothing picked yet" looks like. The board used to ignore
// `error`, so on a dodgy connection the squad was told no side had been named,
// and a manager who tapped Pick → Save from that empty editor deleted the real
// one (save() replaces the whole set; an empty set is a delete).
describe('LineupBoard — a failed load is not "no line-up"', () => {
  const failed = () => ({ ...mock, pool: [], names: {}, hasLineup: false, error: new Error('Load failed'), refetch: vi.fn() })

  test('a player is told it did not load and can retry — not that the side has not been named', async () => {
    mock = failed()
    render(<LineupBoard fixture={{ id: 'f1' }} isAdmin={false} open />)
    expect(screen.queryByText(/line-up not picked yet/i)).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't load the line-up/i)
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(mock.refetch).toHaveBeenCalled()
  })

  test('a manager is not offered "Pick the line-up" on top of a load that failed', () => {
    mock = failed()
    render(<LineupBoard fixture={{ id: 'f1' }} isAdmin open />)
    expect(screen.queryByRole('button', { name: /pick the line-up/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /save line-up/i })).toBeNull()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  // The other side of the same coin. The editor can only be reached after a
  // load that worked, so an error arriving while it is open is the reload after
  // a SAVE failing — the delete may have landed and the insert not, and then
  // the picks on screen are the only copy. They must stay, and Save must work.
  async function pickThenLoseTheReload(start) {
    mock = { ...mock, ...start }
    const { rerender } = render(<LineupBoard fixture={{ id: 'f1' }} isAdmin open />)
    await userEvent.click(screen.getByRole('button', { name: start.hasLineup ? /edit the line-up/i : /pick the line-up/i }))
    await userEvent.click(screen.getByText('GK').closest('button'))
    await userEvent.click(screen.getByText('Joe Bloggs').closest('button'))
    save.mockResolvedValueOnce({ error: new Error('insert failed') })
    await userEvent.click(screen.getByRole('button', { name: /save line-up/i }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    // The hook's reload failed too: same `saved` object, error now set.
    mock = { ...mock, error: new Error('Load failed'), refetch: vi.fn() }
    rerender(<LineupBoard fixture={{ id: 'f1' }} isAdmin open />)
  }

  test('a first pick whose save and reload both failed keeps the editor, the pick and a working Save', async () => {
    await pickThenLoseTheReload({ hasLineup: false })
    expect(screen.queryByText(/couldn't load the line-up/i)).toBeNull()
    // The pick is still in the editor: the second Save sends it again (below).
    const saveBtn = screen.getByRole('button', { name: /save line-up/i })
    expect(saveBtn).toBeEnabled()
    await userEvent.click(saveBtn)
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls[1][0]).toContainEqual(expect.objectContaining({ profile_id: 'p1', position: 'GK' }))
  })

  test('the same while editing an existing line-up: Save is not switched off', async () => {
    await pickThenLoseTheReload({ hasLineup: true, saved: { formation: '4-4-2', starters: {}, subs: ['p2'] } })
    expect(screen.getByRole('button', { name: /save line-up/i })).toBeEnabled()
  })

  test('read-only, after a reload that failed: the board says it may be stale and will not push it', () => {
    mock = { ...mock, hasLineup: true, saved: { formation: '4-4-2', starters: { 0: 'p1' }, subs: [] }, error: new Error('Load failed'), refetch: vi.fn() }
    render(<LineupBoard fixture={{ id: 'f1' }} isAdmin open />)
    expect(screen.getByRole('alert')).toHaveTextContent(/may not be the latest/i)
    expect(screen.getByRole('button', { name: /push the line-up/i })).toBeDisabled()
  })
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

  test('a manager can push the picked line-up to exactly the named players', async () => {
    mock = { ...mock, hasLineup: true, saved: { formation: '4-4-2', starters: { 0: 'p1' }, subs: ['p2'] } }
    const fixture = { id: 'f1', team: { match_name: 'Nottingham' }, opponent: { name: 'Boston' }, home_away: 'Home' }
    render(<LineupBoard fixture={fixture} isAdmin open />)

    await userEvent.click(screen.getByRole('button', { name: /push the line-up to the squad/i }))
    await waitFor(() => expect(invoke).toHaveBeenCalled())
    const [fn, opts] = invoke.mock.calls[0]
    expect(fn).toBe('send-push')
    expect(opts.body.profileIds.sort()).toEqual(['p1', 'p2'])
    expect(opts.body.title).toBe('Nottingham v Boston')
  })

  test('players never see the push button', () => {
    mock = { ...mock, hasLineup: true, saved: { formation: '4-4-2', starters: { 0: 'p1' }, subs: [] } }
    render(<LineupBoard fixture={{ id: 'f1' }} isAdmin={false} open />)
    expect(screen.queryByRole('button', { name: /push the line-up/i })).not.toBeInTheDocument()
  })

  // "Done" is not "Save": leaving the editor without saving must show the SAVED
  // line-up again, not the unsaved picks (which the push button wouldn't send).
  test('Done without saving throws the unsaved picks away', async () => {
    mock = { ...mock, hasLineup: true, saved: { formation: '4-4-2', starters: { 0: 'p1' }, subs: [] } }
    render(<LineupBoard fixture={{ id: 'f1' }} isAdmin open />)
    await userEvent.click(screen.getByRole('button', { name: /edit the line-up/i }))
    await userEvent.click(screen.getByRole('button', { name: /add sub/i }))
    await userEvent.click(screen.getByText('Sam Lee').closest('button'))
    expect(screen.getByText(/SUBS · 1/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^done$/i }))
    expect(save).not.toHaveBeenCalled()
    expect(screen.queryByText(/SUBS · 1/)).not.toBeInTheDocument()
    expect(screen.queryByText('Sam Lee')).not.toBeInTheDocument()
  })
})
