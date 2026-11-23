import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Let the mocked teams fetch settle so its setState lands inside the test.
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

// BUG: the Players page loaded `teams` with `.then(({ data }) => …)` and no
// error check. A failed fetch left teams=[] and PlayerForm then treated every
// squad as unticked on Save — stripping the player from all of them. The page
// must notice the failed load, say so, and offer a retry; and it must not hide
// the squad behind an empty state when the players fetch itself failed.

const TEAMS = [{ id: 't-xl', key: 'xl', label: 'First Team', is_first_team: true }]
const sb = await vi.hoisted(async () => {
  const { makeSupabaseMock } = await import('../test/supabaseMock')
  return { mock: makeSupabaseMock({ teams: [{ id: 't-xl', key: 'xl', label: 'First Team', is_first_team: true }] }) }
})
vi.mock('../lib/supabase', () => ({ supabase: sb.mock.client }))
vi.mock('../lib/logger', () => ({ logError: vi.fn() }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'admin' } }) }))

const playersState = vi.hoisted(() => ({ players: [], loading: false, error: null, refetch: null }))
vi.mock('../hooks/usePlayers', () => ({ usePlayers: () => ({ ...playersState }) }))
// The form is covered by its own test; here we only care what `teams` it's handed.
vi.mock('../components/PlayerForm', () => ({
  default: ({ open, teams }) => (open ? <div data-testid="player-form" data-teams={teams.length} /> : null),
}))

import Players from './Players'

const JOE = { id: 'p1', first_name: 'Joe', last_name: 'Morris', active: true, approved: true, is_player: true, role: 'player', teamKeys: ['xl'], teamIds: ['t-xl'] }

beforeEach(() => {
  sb.mock.reset({ teams: TEAMS })
  playersState.players = [JOE]
  playersState.loading = false
  playersState.error = null
  playersState.refetch = vi.fn()
})

describe('Players — a failed teams (squads) load is surfaced, not swallowed', () => {
  test('shows a visible alert with a retry, and the retry re-queries teams', async () => {
    sb.mock.failWith('teams', { message: 'boom', code: '500' })
    render(<Players />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/squads didn't load/i)
    expect(sb.mock.calls.filter((c) => c.table === 'teams')).toHaveLength(1)

    // Connection comes back: Try again reloads and the alert clears.
    sb.mock.reset({ teams: TEAMS })
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(sb.mock.calls.filter((c) => c.table === 'teams')).toHaveLength(1) // the retry (calls were reset)

    // …and the form now gets the loaded squads.
    await userEvent.click(screen.getByRole('button', { name: /add a player/i }))
    expect(screen.getByTestId('player-form')).toHaveAttribute('data-teams', '1')
  })

  test('with teams loaded fine there is no alert', async () => {
    render(<Players />)
    await waitFor(() => expect(sb.mock.calls.filter((c) => c.table === 'teams')).toHaveLength(1))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText(/Joe Morris/)).toBeInTheDocument()
  })
})

describe('Players — a failed players load is not an empty squad', () => {
  test('first load failed → error + Try again (calls refetch), never "No active players."', async () => {
    playersState.players = []
    playersState.error = { message: 'boom' }
    render(<Players />)
    await settle()
    expect(screen.queryByText(/no active players/i)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(playersState.refetch).toHaveBeenCalled()
  })

  test('a refetch with players already loaded keeps the list on screen (no Loader)', async () => {
    playersState.loading = true
    render(<Players />)
    await settle()
    expect(screen.getByText(/Joe Morris/)).toBeInTheDocument()
  })
})

// Every self sign-up lands approved=false, supporters included (the trigger in
// 0034). The queue, the Pending tag and the form's sign-off control were all
// gated on is_player, so a supporter could never be signed off: no news pushes
// (send-push requires approved) and no photo (storage RLS requires it too),
// while his row looked like any other supporter's.
describe('Players — a supporter can be signed off too', () => {
  const SUE = { id: 's1', first_name: 'Sue', last_name: 'Fan', active: true, approved: false, is_player: false, role: 'player', teamKeys: [], teamIds: [] }

  test('a pending player has independent keyboard actions for edit and sign off', async () => {
    playersState.players = [{ ...JOE, approved: false }]
    render(<Players />)
    await settle()
    const edit = screen.getByText('Joe Morris').closest('button')
    const approve = screen.getByText('Sign off')
    expect(edit).not.toContainElement(approve)
    expect(edit).toHaveAccessibleName('Edit Joe Morris')
    expect(approve).toHaveAccessibleName('Sign off Joe Morris')
    edit.focus()
    await userEvent.tab()
    expect(approve).toHaveFocus()
    await userEvent.keyboard(' ')
    expect(playersState.refetch).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('player-form')).toBeNull()
    await userEvent.tab({ shift: true })
    await userEvent.keyboard('{Enter}')
    expect(screen.getByTestId('player-form')).toBeInTheDocument()
    expect(sb.mock.writes).toHaveLength(1)
  })

  test('an unapproved supporter waits in the sign-off queue, tagged, and one tap signs her off', async () => {
    playersState.players = [JOE, SUE]
    render(<Players />)
    await settle()
    const queue = screen.getByText(/awaiting sign-off · 1/i).parentElement
    expect(within(queue).getByText(/Sue Fan/)).toBeInTheDocument()
    expect(within(queue).getByText('Pending')).toBeInTheDocument()
    expect(within(queue).getByText('Supporter')).toBeInTheDocument()

    await userEvent.click(within(queue).getByText('Sign off'))
    await settle()
    expect(sb.mock.writes).toContainEqual({ table: 'profiles', op: 'update', payload: { approved: true } })
    expect(playersState.refetch).toHaveBeenCalled()
  })

  test('once signed off she sits under Supporters, and nobody is left waiting', async () => {
    playersState.players = [JOE, { ...SUE, approved: true }]
    render(<Players />)
    await settle()
    expect(screen.queryByText(/awaiting sign-off/i)).toBeNull()
    const supporters = screen.getByText(/supporters · 1/i).parentElement
    expect(within(supporters).getByText(/Sue Fan/)).toBeInTheDocument()
    expect(within(supporters).queryByText('Pending')).toBeNull()
  })

  test('she is listed once: waiting, not also under Supporters', async () => {
    playersState.players = [JOE, SUE]
    render(<Players />)
    await settle()
    expect(screen.getAllByText(/Sue Fan/)).toHaveLength(1)
    expect(screen.queryByText(/supporters · /i)).toBeNull()
  })
})

describe('Players — supporters are signed off like players', () => {
  const SUP = { id: 'p2', first_name: 'Sue', last_name: 'Fan', active: true, approved: false, is_player: false, role: 'player', teamKeys: [], teamIds: [] }
  const NEWBIE = { id: 'p3', first_name: 'Nat', last_name: 'New', active: true, approved: false, is_player: true, role: 'player', teamKeys: [], teamIds: [] }
  const APPROVED_SUP = { ...SUP, id: 'p4', first_name: 'Ann', last_name: 'Approved', approved: true }

  test('an unapproved supporter is in the sign-off queue, tagged Supporter; an unapproved player is tagged Player', async () => {
    playersState.players = [JOE, SUP, NEWBIE, APPROVED_SUP]
    render(<Players />)
    await settle()
    expect(screen.getByText(/awaiting sign-off · 2/i)).toBeInTheDocument()
    const sue = screen.getByText(/Sue Fan/).closest('.pl-row')
    expect(sue).toHaveTextContent('Supporter')
    expect(sue).toHaveTextContent('Pending')
    expect(sue).toHaveTextContent('Sign off')
    const nat = screen.getByText(/Nat New/).closest('button')
    expect(nat).toHaveTextContent('Player')
    expect(nat).toHaveTextContent('Pending')
  })

  test('an approved supporter is in Supporters, not the queue, with no Sign off button', async () => {
    playersState.players = [APPROVED_SUP]
    render(<Players />)
    await settle()
    expect(screen.queryByText(/awaiting sign-off/i)).toBeNull()
    expect(screen.getByText(/supporters · 1/i)).toBeInTheDocument()
    expect(screen.getByText(/Ann Approved/).closest('button')).not.toHaveTextContent('Sign off')
  })

  test('signing off a supporter sets approved=true on their profile and nothing else', async () => {
    playersState.players = [SUP]
    render(<Players />)
    await settle()
    sb.mock.reset({ teams: TEAMS })
    await userEvent.click(screen.getByText('Sign off'))
    const writes = sb.mock.calls.filter((c) => c.table !== 'teams')
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.every((c) => c.table === 'profiles')).toBe(true)
    expect(JSON.stringify(writes)).toContain('"approved":true')
    expect(playersState.refetch).toHaveBeenCalled()
  })
})
