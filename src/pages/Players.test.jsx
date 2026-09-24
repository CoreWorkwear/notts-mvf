import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
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
