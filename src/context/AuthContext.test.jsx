import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'

// Two resilience contracts:
//  - startup ALWAYS releases the splash (the cold-start hang class), and
//  - a FAILED profile load never wipes a loaded profile — applying an errored
//    response used to null the profile and show an approved player as
//    "awaiting sign-off" for the whole session.

const store = vi.hoisted(() => ({ profile: null, profErr: null, hold: false, held: [], profileFetches: 0, stored: false }))
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
    // Whether supabase-js still has a session in storage (a failed refresh on a
    // dead signal leaves it there; a refused one removes it).
    hasStoredSession: () => store.stored,
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
const resetLogState = vi.hoisted(() => vi.fn())
vi.mock('../lib/logger', () => ({ logError: vi.fn(), resetLogState }))
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
  store.stored = false
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
    await waitFor(() => expect(screen.getByText(/expired or been used already/i)).toBeInTheDocument())
    expect(window.location.hash).toBe('')
  })

  test('error_description is NEVER shown — spoofed link text is replaced by fixed copy', async () => {
    window.history.replaceState(null, '', '/#error=server_error&error_code=unexpected_failure&error_description=Your+account+is+locked.+Call+0800+123+456')
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } })
    render(<AuthProvider><RecoveryProbe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText(/something went wrong with that link/i)).toBeInTheDocument())
    expect(screen.queryByText(/locked|0800/)).toBeNull()
    expect(window.location.hash).toBe('')
  })

  test('even an otp_expired code ignores a spoofed description', async () => {
    window.history.replaceState(null, '', '/#error=access_denied&error_code=otp_expired&error_description=Visit+evil.example')
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } })
    render(<AuthProvider><RecoveryProbe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText(/expired or been used already/i)).toBeInTheDocument())
    expect(screen.queryByText(/evil/)).toBeNull()
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

describe('AuthContext — sign-out clears the logger state', () => {
  test('signOut resets the offline error queue and breadcrumb trail', async () => {
    store.profile = { id: 'u1', first_name: 'Joe', role: 'player', approved: true, active: true, is_player: true, club_id: null }
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } })
    render(<AuthProvider><ProfileProbe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('Joe')).toBeInTheDocument())
    expect(resetLogState).not.toHaveBeenCalled()
    await act(async () => { screen.getByText('signout').click() })
    expect(resetLogState).toHaveBeenCalled()
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

// Pitch-side cold start, more than an hour since the app was last open, weak or
// no signal. The access token has expired, so supabase-js has to refresh it
// before it can hand a session over. Two things went wrong:
//  1. the refresh failing (or simply outlasting the 6s safety timer) left
//     session=null, which the app read as "signed out" and showed the sign-in
//     form to a signed-in player, though the session was still in storage;
//  2. when signal came back the only event was TOKEN_REFRESHED, which was
//     skipped unconditionally, so the app appeared with profile=null:
//     "Availability is closed for this one", a blank You, no Manage.
function ReconnectProbe() {
  const { loading, isAuthed, reconnecting, profile, retryRestore, signInInstead } = useAuth()
  return (
    <div>
      <span>{loading ? 'LOADING' : !isAuthed ? (reconnecting ? 'RECONNECTING' : 'SIGN-IN') : 'APP'}</span>
      <span>{profile?.first_name ?? 'NO-PROFILE'}</span>
      <button onClick={retryRestore}>retry</button>
      <button onClick={signInInstead}>sign-in-instead</button>
    </div>
  )
}

describe('AuthContext — a stored session that could not be restored is not "signed out"', () => {
  const joe = { id: 'u1', first_name: 'Joe', role: 'player', approved: true, active: true, is_player: true, club_id: null }
  const capture = () => {
    const ref = {}
    supabase.auth.onAuthStateChange.mockImplementation((fn) => { ref.cb = fn; return { data: { subscription: { unsubscribe() {} } } } })
    return ref
  }

  test('the refresh failed but the session is still stored: reconnecting, not the sign-in form', async () => {
    store.stored = true
    supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: new Error('Failed to fetch') })
    render(<AuthProvider><ReconnectProbe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('RECONNECTING')).toBeInTheDocument())
    expect(screen.queryByText('SIGN-IN')).toBeNull()
  })

  test('the refresh was refused and the session is gone: that IS signed out', async () => {
    store.stored = false
    supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: new Error('Invalid Refresh Token') })
    render(<AuthProvider><ReconnectProbe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('SIGN-IN')).toBeInTheDocument())
  })

  test('the safety timer fires while the refresh is still out: reconnecting, not the sign-in form', async () => {
    vi.useFakeTimers()
    store.stored = true
    supabase.auth.getSession.mockReturnValue(new Promise(() => {}))
    render(<AuthProvider><ReconnectProbe /></AuthProvider>)
    await act(async () => { vi.advanceTimersByTime(6000) })
    expect(screen.getByText('RECONNECTING')).toBeInTheDocument()
  })

  test('INITIAL_SESSION arriving empty first does not flash the sign-in form either', async () => {
    store.stored = true
    const ref = capture()
    supabase.auth.getSession.mockReturnValue(new Promise(() => {}))
    render(<AuthProvider><ReconnectProbe /></AuthProvider>)
    await act(async () => { ref.cb('INITIAL_SESSION', null) })
    expect(screen.getByText('RECONNECTING')).toBeInTheDocument()
  })

  test('signal returns: TOKEN_REFRESHED brings the session AND loads the profile', async () => {
    store.stored = true
    store.profile = joe
    const ref = capture()
    supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: new Error('Failed to fetch') })
    render(<AuthProvider><ReconnectProbe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('RECONNECTING')).toBeInTheDocument())

    await act(async () => { ref.cb('TOKEN_REFRESHED', { user: { id: 'u1' } }) })
    await waitFor(() => expect(screen.getByText('Joe')).toBeInTheDocument())
    expect(screen.getByText('APP')).toBeInTheDocument()
  })

  test('an ordinary hourly TOKEN_REFRESHED still does not reload a profile that is already loaded', async () => {
    store.profile = joe
    const ref = capture()
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } })
    render(<AuthProvider><ReconnectProbe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('Joe')).toBeInTheDocument())
    const before = store.profileFetches

    await act(async () => { ref.cb('TOKEN_REFRESHED', { user: { id: 'u1' } }) })
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    expect(store.profileFetches).toBe(before)
  })

  test('"Try again" that works brings the app back with the profile', async () => {
    store.stored = true
    store.profile = joe
    supabase.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: new Error('Failed to fetch') })
    render(<AuthProvider><ReconnectProbe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('RECONNECTING')).toBeInTheDocument())

    supabase.auth.getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'u1' } } }, error: null })
    await act(async () => { screen.getByText('retry').click() })
    await waitFor(() => expect(screen.getByText('Joe')).toBeInTheDocument())
    expect(screen.getByText('APP')).toBeInTheDocument()
  })

  test('"Try again" that finds the session revoked falls through to the sign-in form', async () => {
    store.stored = true
    supabase.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: new Error('Failed to fetch') })
    render(<AuthProvider><ReconnectProbe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('RECONNECTING')).toBeInTheDocument())

    store.stored = false // supabase-js removed it: the refresh token was refused
    supabase.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: new Error('Invalid Refresh Token') })
    await act(async () => { screen.getByText('retry').click() })
    await waitFor(() => expect(screen.getByText('SIGN-IN')).toBeInTheDocument())
  })

  test('"Try again" that still cannot get through stays put', async () => {
    store.stored = true
    supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: new Error('Failed to fetch') })
    render(<AuthProvider><ReconnectProbe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('RECONNECTING')).toBeInTheDocument())
    await act(async () => { screen.getByText('retry').click() })
    expect(screen.getByText('RECONNECTING')).toBeInTheDocument()
  })

  test('the player can choose the sign-in form instead', async () => {
    store.stored = true
    supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: new Error('Failed to fetch') })
    render(<AuthProvider><ReconnectProbe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('RECONNECTING')).toBeInTheDocument())
    await act(async () => { screen.getByText('sign-in-instead').click() })
    expect(screen.getByText('SIGN-IN')).toBeInTheDocument()
  })

  // On a dead signal supabase-js spends tens of seconds in refresh backoff, so
  // getSession and the empty INITIAL_SESSION land long after the safety timer
  // put the reconnect screen up. Both used to put it straight back over a
  // sign-in form the player had chosen and was typing into.
  test('"Sign in instead" sticks when the slow answers finally arrive', async () => {
    vi.useFakeTimers()
    store.stored = true
    const ref = capture()
    let answer
    supabase.auth.getSession.mockReturnValue(new Promise((r) => { answer = r }))
    render(<AuthProvider><ReconnectProbe /></AuthProvider>)
    await act(async () => { vi.advanceTimersByTime(6000) })
    expect(screen.getByText('RECONNECTING')).toBeInTheDocument()

    await act(async () => { screen.getByText('sign-in-instead').click() })
    expect(screen.getByText('SIGN-IN')).toBeInTheDocument()

    await act(async () => { answer({ data: { session: null }, error: new Error('Failed to fetch') }) })
    await act(async () => { ref.cb('INITIAL_SESSION', null) })
    expect(screen.getByText('SIGN-IN')).toBeInTheDocument()
  })

  test('...and a session arriving after that still brings the app up', async () => {
    store.stored = true
    store.profile = joe
    const ref = capture()
    supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: new Error('Failed to fetch') })
    render(<AuthProvider><ReconnectProbe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('RECONNECTING')).toBeInTheDocument())
    await act(async () => { screen.getByText('sign-in-instead').click() })

    await act(async () => { ref.cb('TOKEN_REFRESHED', { user: { id: 'u1' } }) })
    await waitFor(() => expect(screen.getByText('Joe')).toBeInTheDocument())
  })

  test('signing out for real clears it', async () => {
    store.stored = true
    const ref = capture()
    supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: new Error('Failed to fetch') })
    render(<AuthProvider><ReconnectProbe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('RECONNECTING')).toBeInTheDocument())
    store.stored = false
    await act(async () => { ref.cb('SIGNED_OUT', null) })
    expect(screen.getByText('SIGN-IN')).toBeInTheDocument()
  })
})
