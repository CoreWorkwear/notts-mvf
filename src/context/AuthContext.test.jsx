import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'

// Two resilience contracts:
//  - startup ALWAYS releases the splash (the cold-start hang class), and
//  - a FAILED profile load never wipes a loaded profile — applying an errored
//    response used to null the profile and show an approved player as
//    "awaiting sign-off" for the whole session.

const store = vi.hoisted(() => ({ profile: null, profErr: null }))
vi.mock('../lib/supabase', () => {
  const table = (t) => {
    const result = () =>
      t === 'profiles'
        ? { data: store.profErr ? null : store.profile, error: store.profErr }
        : { data: [], error: null }
    const q = {
      select: () => q,
      eq: () => q,
      single: () => Promise.resolve(result()),
      then: (res, rej) => Promise.resolve(result()).then(res, rej),
    }
    return q
  }
  return {
    supabase: {
      auth: {
        getSession: vi.fn(),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
      },
      from: (t) => table(t),
    },
  }
})
vi.mock('../lib/logger', () => ({ logError: vi.fn() }))

import { supabase } from '../lib/supabase'
import { AuthProvider, useAuth } from './AuthContext'

function Probe() {
  const { loading } = useAuth()
  return <div>{loading ? 'LOADING' : 'READY'}</div>
}

function ProfileProbe() {
  const { profile, refreshProfile } = useAuth()
  return (
    <div>
      <span>{profile?.first_name ?? 'NO-PROFILE'}</span>
      <button onClick={refreshProfile}>refresh</button>
    </div>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  store.profile = null
  store.profErr = null
})
afterEach(() => { vi.useRealTimers() })

describe('AuthContext startup resilience', () => {
  test('a FAILED session restore still releases the splash (no infinite hang)', async () => {
    supabase.auth.getSession.mockRejectedValue(new Error('network down'))
    render(<AuthProvider><Probe /></AuthProvider>)
    expect(screen.getByText('LOADING')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('READY')).toBeInTheDocument())
  })

  test('a session restore that NEVER settles releases after the safety timeout', async () => {
    vi.useFakeTimers()
    supabase.auth.getSession.mockReturnValue(new Promise(() => {})) // never resolves
    render(<AuthProvider><Probe /></AuthProvider>)
    expect(screen.getByText('LOADING')).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(6000) })
    expect(screen.getByText('READY')).toBeInTheDocument()
  })
})

describe('AuthContext — a failed load never wipes a loaded profile', () => {
  test('an errored refresh keeps the profile (no phantom "awaiting sign-off")', async () => {
    store.profile = { id: 'u1', first_name: 'Joe', role: 'player', approved: true, active: true, is_player: true, club_id: null }
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } })
    render(<AuthProvider><ProfileProbe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('Joe')).toBeInTheDocument())

    store.profErr = { message: 'transient 5xx' } // the next load fails at the response level
    await act(async () => { screen.getByText('refresh').click() })

    // The good profile must survive the failed refresh.
    expect(screen.getByText('Joe')).toBeInTheDocument()
    expect(screen.queryByText('NO-PROFILE')).toBeNull()
  })
})
