import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'

// Two resilience contracts:
//  - startup ALWAYS releases the splash (the cold-start hang class), and
//  - a FAILED profile load never wipes a loaded profile — applying an errored
//    response used to null the profile and show an approved player as
//    "awaiting sign-off" for the whole session.

const store = vi.hoisted(() => ({ profile: null, profErr: null, hold: false, held: [], profileFetches: 0 }))
vi.mock('../lib/supabase', () => {
  const table = (t) => {
    if (t === 'profiles') store.profileFetches++
    const result = () =>
      t === 'profiles'
        ? { data: store.profErr ? null : store.profile, error: store.profErr }
        : { data: [], error: null }
    // store.hold parks the response until the test releases it (slow profile RTT).
    const gate = store.hold ? new Promise((r) => store.held.push(r)) : Promise.resolve()
    const q = {
      select: () => q,
      eq: () => q,
      single: () => gate.then(result),
      then: (res, rej) => gate.then(result).then(res, rej),
    }
    return q
  }
  return {
    supabase: {
      auth: {
        getSession: vi.fn(),
        signOut: vi.fn(() => Promise.resolve({ error: null })),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
      },
      from: (t) => table(t),
    },
  }
})
vi.mock('../lib/logger', () => ({ logError: vi.fn() }))
const disablePush = vi.hoisted(() => vi.fn(() => Promise.resolve()))
vi.mock('../lib/push', () => ({ disablePush }))

import { supabase } from '../lib/supabase'
import { AuthProvider, useAuth } from './AuthContext'

function Probe() {
  const { loading } = useAuth()
  return <div>{loading ? 'LOADING' : 'READY'}</div>
}

function ProfileProbe() {
  const { profile, refreshProfile, signOut } = useAuth()
  return (
    <div>
      <span>{profile?.first_name ?? 'NO-PROFILE'}</span>
      <button onClick={refreshProfile}>refresh</button>
      <button onClick={signOut}>signout</button>
    </div>
  )
}

function RecoveryProbe() {
  const { authNotice, passwordRecovery } = useAuth()
  return <div><span>{authNotice ?? 'NO-NOTICE'}</span><span>{passwordRecovery ? 'RECOVERY' : 'NORMAL'}</span></div>
}

beforeEach(() => {
  vi.clearAllMocks()
  store.profile = null
  store.profErr = null
  store.hold = false
  store.held = []
  store.profileFetches = 0
  supabase.auth.onAuthStateChange.mockImplementation(() => ({ data: { subscription: { unsubscribe: () => {} } } }))
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
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

describe('AuthContext — sign-out is shared-device safe', () => {
  test('signing out tears down push BEFORE revoking the session (next user must not get your notifications)', async () => {
    store.profile = { id: 'u1', first_name: 'Joe', role: 'player', approved: true, active: true, is_player: true, club_id: null }
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } })
    render(<AuthProvider><ProfileProbe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('Joe')).toBeInTheDocument())

    await act(async () => { screen.getByText('signout').click() })

    expect(disablePush).toHaveBeenCalledWith('u1')
    // The token-row delete needs a live session, so push teardown must run first.
    expect(disablePush.mock.invocationCallOrder[0]).toBeLessThan(supabase.auth.signOut.mock.invocationCallOrder[0])
  })
})

// Cold start: supabase-js fires INITIAL_SESSION the moment it has read the
// stored session — BEFORE the profile round-trip. The callback used to release
// the splash right there, so for the length of that round-trip (seconds on a
// phone waking its radio) the app rendered with isAuthed=true and profile=null:
// approved players saw "the manager just needs to sign you off", managers saw
// a player's nav and were bounced off admin routes. Hold the splash until the
// profile is known (the 6s safety timer still backstops a fetch that never
// settles), and don't load the same profile twice on one start-up.
describe('AuthContext — the splash holds until the profile is known', () => {
  const joe = { id: 'u1', first_name: 'Joe', role: 'player', approved: true, active: true, is_player: true, club_id: null }

  test('INITIAL_SESSION with a slow profile fetch stays LOADING, then READY with the profile', async () => {
    let cb
    supabase.auth.onAuthStateChange.mockImplementation((fn) => { cb = fn; return { data: { subscription: { unsubscribe() {} } } } })
    supabase.auth.getSession.mockReturnValue(new Promise(() => {})) // isolate the callback path
    store.profile = joe
    store.hold = true
    render(<AuthProvider><Probe /><ProfileProbe /></AuthProvider>)
    await act(async () => { cb('INITIAL_SESSION', { user: { id: 'u1' } }) })
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) }) // the deferred load has started
    expect(screen.getByText('LOADING')).toBeInTheDocument()
    expect(screen.queryByText('READY')).toBeNull()

    await act(async () => { store.held.splice(0).forEach((r) => r()) })
    await waitFor(() => expect(screen.getByText('READY')).toBeInTheDocument())
    expect(screen.getByText('Joe')).toBeInTheDocument()
  })

  test('INITIAL_SESSION with NO session releases straight away (sign-in screen)', async () => {
    let cb
    supabase.auth.onAuthStateChange.mockImplementation((fn) => { cb = fn; return { data: { subscription: { unsubscribe() {} } } } })
    supabase.auth.getSession.mockReturnValue(new Promise(() => {}))
    render(<AuthProvider><Probe /></AuthProvider>)
    await act(async () => { cb('INITIAL_SESSION', null) })
    expect(screen.getByText('READY')).toBeInTheDocument()
  })

  test('getSession + INITIAL_SESSION on the same start-up load the profile ONCE, not twice', async () => {
    let cb
    supabase.auth.onAuthStateChange.mockImplementation((fn) => { cb = fn; return { data: { subscription: { unsubscribe() {} } } } })
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } })
    store.profile = joe
    render(<AuthProvider><Probe /><ProfileProbe /></AuthProvider>)
    await act(async () => { cb('INITIAL_SESSION', { user: { id: 'u1' } }) })
    await waitFor(() => expect(screen.getByText('Joe')).toBeInTheDocument())
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    expect(store.profileFetches).toBe(1)
  })

  test('a profile fetch that NEVER settles still releases after the safety timeout', async () => {
    vi.useFakeTimers()
    let cb
    supabase.auth.onAuthStateChange.mockImplementation((fn) => { cb = fn; return { data: { subscription: { unsubscribe() {} } } } })
    supabase.auth.getSession.mockReturnValue(new Promise(() => {}))
    store.profile = joe
    store.hold = true
    render(<AuthProvider><Probe /></AuthProvider>)
    await act(async () => { cb('INITIAL_SESSION', { user: { id: 'u1' } }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    expect(screen.getByText('READY')).toBeInTheDocument()
  })
})

// A failed recovery link comes back as a #error=… hash that supabase-js drops
// without an event — the player used to land on sign-in with no explanation.
describe('AuthContext — failed recovery links are explained', () => {
  test('an otp_expired hash sets authNotice and strips the hash', async () => {
    window.history.replaceState(null, '', '/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } })
    render(<AuthProvider><RecoveryProbe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText(/expired or already been used/i)).toBeInTheDocument())
    expect(window.location.hash).toBe('')
  })

  test('a clean load has no notice', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } })
    render(<AuthProvider><RecoveryProbe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('NO-NOTICE')).toBeInTheDocument())
  })
})

// passwordRecovery was memory-only React state: a reload (or iOS discarding
// the PWA tab) between clicking the reset link and saving the new password
// restored the recovery session as an ordinary sign-in and the set-password
// screen never came back.
describe('AuthContext — an interrupted recovery survives a reload', () => {
  test('the recovery flag persists across a provider remount while the session lives', async () => {
    store.profile = { id: 'u1', first_name: 'Joe', role: 'player', approved: true, active: true, is_player: true, club_id: null }
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } })
    let cb
    supabase.auth.onAuthStateChange.mockImplementation((fn) => { cb = fn; return { data: { subscription: { unsubscribe() {} } } } })
    const first = render(<AuthProvider><RecoveryProbe /></AuthProvider>)
    await act(async () => { cb('PASSWORD_RECOVERY', { user: { id: 'u1' } }) })
    expect(screen.getByText('RECOVERY')).toBeInTheDocument()

    first.unmount() // the "reload"
    render(<AuthProvider><RecoveryProbe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('RECOVERY')).toBeInTheDocument())
  })

  test('a persisted flag with NO session behind it is dropped (no stranded set-password screen)', async () => {
    sessionStorage.setItem('mvf:passwordRecovery', '1')
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } })
    render(<AuthProvider><RecoveryProbe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('NORMAL')).toBeInTheDocument())
  })
})

describe('AuthContext — offline sign-out still signs this device out', () => {
  test('a failed global revoke falls back to a local sign-out', async () => {
    store.profile = { id: 'u1', first_name: 'Joe', role: 'player', approved: true, active: true, is_player: true, club_id: null }
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } })
    supabase.auth.signOut.mockImplementation((opts) =>
      opts?.scope === 'local' ? Promise.resolve({ error: null }) : Promise.resolve({ error: { message: 'Failed to fetch' } }))
    render(<AuthProvider><ProfileProbe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('Joe')).toBeInTheDocument())

    await act(async () => { screen.getByText('signout').click() })
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })
})
