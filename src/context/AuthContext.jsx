import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { canSetAvailability, accountStatus, respondBlock } from '../lib/players'
import { disablePush } from '../lib/push'
import { logError } from '../lib/logger'

const AuthContext = createContext(null)

const MANAGER_VIEW_KEY = 'mvf:managerView'
// Session-scoped: recovery must survive a reload / iOS tab discard between
// clicking the reset link and saving the new password, but not outlive the tab.
const RECOVERY_KEY = 'mvf:passwordRecovery'

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [club, setClub] = useState(null) // club row (name, crest_url)
  const [teamKeys, setTeamKeys] = useState([]) // ['xl','community']
  // The same squads by id. team_id is what a fixture row carries, so this is
  // what the per-fixture availability gate compares against (0034).
  const [teamIds, setTeamIds] = useState([])
  const [loading, setLoading] = useState(true)
  const [passwordRecovery, setPasswordRecoveryState] = useState(() => {
    try { return sessionStorage.getItem(RECOVERY_KEY) === '1' } catch { return false }
  })
  const setPasswordRecovery = useCallback((on) => {
    setPasswordRecoveryState(on)
    try { on ? sessionStorage.setItem(RECOVERY_KEY, '1') : sessionStorage.removeItem(RECOVERY_KEY) } catch { /* private mode */ }
  }, [])
  // A failed recovery link (expired / already used) — surfaced on the sign-in
  // screen instead of silently swallowed.
  const [authNotice, setAuthNotice] = useState(null)
  // §3 Manager view — a COSMETIC toggle. Default OFF, so a real admin uses the app
  // as a player day-to-day and flips this on to reveal management tools. It NEVER
  // grants authority: every admin action is still enforced by RLS at the database,
  // so showing a button to a non-admin (or with the view off) changes nothing the
  // server will accept. Persisted so it survives reloads.
  const [managerView, setManagerViewState] = useState(() => {
    try { return localStorage.getItem(MANAGER_VIEW_KEY) === '1' } catch { return false }
  })
  const setManagerView = useCallback((on) => {
    setManagerViewState(on)
    try { localStorage.setItem(MANAGER_VIEW_KEY, on ? '1' : '0') } catch { /* private mode */ }
  }, [])

  // Pull the profile row + team memberships + club for the signed-in user.
  const loadProfile = useCallback(async (uid) => {
    if (!uid) { setProfile(null); setTeamKeys([]); setTeamIds([]); setClub(null); return }
    const [profRes, memRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', uid).single(),
      supabase.from('team_memberships').select('team_id, teams(key)').eq('profile_id', uid),
    ])
    // A response-level error is a FAILED load, not an empty account. Applying
    // it would null a perfectly good profile and show an approved player as
    // "awaiting sign-off" for the rest of the session. Keep whatever we have
    // and throw — the caller logs it, and the next focus/refresh retries.
    if (profRes.error || memRes.error) throw (profRes.error ?? memRes.error)
    const prof = profRes.data
    const memberships = memRes.data
    setProfile(prof ?? null)
    setTeamKeys((memberships ?? []).map((m) => m.teams?.key).filter(Boolean))
    setTeamIds((memberships ?? []).map((m) => m.team_id).filter(Boolean))
    if (prof?.club_id) {
      const { data: c, error: cErr } = await supabase.from('clubs').select('id, name, crest_url').eq('id', prof.club_id).single()
      if (cErr) throw cErr // keep the previous club (crest) rather than blanking it
      setClub(c ?? null)
    } else setClub(null)
  }, [])

  // Which user's profile is in flight / already loaded, so the two start-up
  // paths below (getSession + INITIAL_SESSION) load it once, not twice.
  const inflightFor = useRef(null)
  const loadedFor = useRef(null)

  useEffect(() => {
    let active = true
    // An expired or already-used reset link bounces back as
    // #error=access_denied&error_code=otp_expired&error_description=… and
    // supabase-js drops it without an event — the player used to land on the
    // sign-in screen with no explanation at all. Read it, say so, strip it.
    try {
      const h = new URLSearchParams((window.location.hash || '').replace(/^#/, ''))
      if (h.get('error') || h.get('error_code')) {
        const code = `${h.get('error_code') || ''} ${h.get('error') || ''}`
        setAuthNotice(/otp_expired|access_denied/.test(code)
          ? 'That reset link has expired or already been used — request a fresh one below.'
          : ((h.get('error_description') || '').replace(/\+/g, ' ') || 'Something went wrong with that link — try again.'))
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
      }
    } catch { /* hash parsing is best-effort */ }

    // Never let startup hang on the splash. If session restore stalls or fails
    // (slow cold-start network / a token refresh that errors), we STILL release the
    // UI: every path below releases on resolve OR reject, and the safety timer is
    // a backstop for the rare case nothing settles at all.
    const safety = setTimeout(() => { if (active) setLoading(false) }, 6000)
    const release = () => { if (active) { clearTimeout(safety); setLoading(false) } }

    // The splash is held until the PROFILE is known, not just the session:
    // releasing on the bare session rendered the app with profile=null for the
    // length of the profile round-trip (seconds on a phone waking its radio),
    // and in that window approved players read "the manager just needs to sign
    // you off" and managers were bounced off admin routes as non-admins.
    const loadThenRelease = (uid, op) => {
      if (!uid) { loadedFor.current = null; loadProfile(undefined); release(); return }
      if (inflightFor.current === uid) return // the in-flight load will release
      if (loadedFor.current === uid) { release(); return }
      inflightFor.current = uid
      loadProfile(uid)
        .then(() => { loadedFor.current = uid })
        .catch((e) => logError('auth', e ?? op + ' failed', { op }))
        .finally(() => { if (inflightFor.current === uid) inflightFor.current = null; release() })
    }

    supabase.auth.getSession()
      .then(({ data }) => {
        if (!active) return
        setSession(data.session)
        // A persisted recovery flag with NO session behind it (the recovery
        // session expired while the tab was away) would strand the app on the
        // set-password screen with nothing to update — drop it.
        if (!data.session) setPasswordRecovery(false)
        loadThenRelease(data.session?.user?.id, 'sessionRestore')
      })
      .catch((e) => { logError('auth', e ?? 'session restore failed', { op: 'sessionRestore' }); release() })

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // Clicking a reset-password email lands here with a recovery session —
      // flag it so the app shows the set-new-password screen, not the app.
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
      setSession(s)
      // TOKEN_REFRESHED changes nothing profile-shaped: skip the reload.
      if (event === 'TOKEN_REFRESHED') return
      if (!s) { loadedFor.current = null; loadProfile(undefined); release(); return }
      // USER_UPDATED (e.g. a password change) may carry profile-shaped changes.
      if (event === 'USER_UPDATED') loadedFor.current = null
      // Do NOT await Supabase calls inside this callback: supabase-js holds its
      // auth lock while it runs, and queries acquire that same lock to attach
      // the token — the documented deadlock behind cold-start hangs. Defer the
      // profile load out of the callback instead.
      setTimeout(() => { if (active) loadThenRelease(s.user?.id, 'profileLoad') }, 0)
    })
    return () => { active = false; clearTimeout(safety); sub.subscription.unsubscribe() }
  }, [loadProfile])

  // --- auth actions -------------------------------------------------------
  async function signIn(email, password) {
    return supabase.auth.signInWithPassword({ email, password })
  }

  // Register writes the trigger metadata. Server forces player/not-eligible and
  // lands them pending (approved=false). is_player=false signs up a supporter.
  async function signUp({ email, password, first_name, last_name, phone, positions, preferred, teams, is_player = true }) {
    return supabase.auth.signUp({
      email,
      password,
      options: { data: { first_name, last_name, phone, positions, preferred, teams, is_player } },
    })
  }

  // Shared-device hygiene: unsubscribe push and drop this device's token row
  // BEFORE the auth token is revoked (the delete needs RLS), or the next
  // person on this phone receives — and can one-tap act on — the outgoing
  // user's notifications. Best-effort and time-boxed so sign-out never hangs
  // on a dead connection.
  async function signOut() {
    try {
      const uid = session?.user?.id
      if (uid) await Promise.race([disablePush(uid), new Promise((r) => setTimeout(r, 2500))])
    } catch { /* best-effort — sign-out must proceed regardless */ }
    // Offline, the global revoke fails and supabase-js KEEPS the local
    // session — the button silently did nothing and the account stayed live
    // on the device. Fall back to a local sign-out so this device signs out
    // regardless; the server-side refresh token just expires on its own.
    const { error } = await supabase.auth.signOut()
    if (error) await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
    return { error: null }
  }

  // Send a reset link (logged-out "forgot password"). Lands back on the app via
  // the recovery email; redirectTo must be an allowed Redirect URL in Supabase.
  async function sendPasswordReset(email) {
    return supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin })
  }
  // Set the new password once on the recovery session.
  async function updatePassword(password) {
    return supabase.auth.updateUser({ password })
  }

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    club,
    teamKeys,
    teamIds,
    loading,
    isAuthed: !!session,
    // isRealAdmin = the actual DB role (the truth). isAdmin = the EFFECTIVE,
    // view-aware flag every UI gate reads: an admin only sees management UI when
    // manager view is on. Security never depends on either — RLS does that.
    isRealAdmin: profile?.role === 'admin',
    isAdmin: profile?.role === 'admin' && managerView,
    managerView,
    setManagerView,
    // Account state for the "can view, can't act" gate.
    approved: !!profile?.approved,
    isPlayer: profile?.is_player !== false,
    canRespond: canSetAvailability(profile),   // approved + active + a player
    accountStatus: accountStatus(profile),     // 'pending' | 'supporter' | 'inactive' | 'active'
    // Per-FIXTURE gate (0034): account state AND being in that game's squad AND
    // the game not having kicked off. null = they can answer. The account-level
    // canRespond above still drives the page banner; this drives the buttons.
    respondBlockFor: (fixture) => respondBlock(profile, teamIds, fixture),
    passwordRecovery,
    endRecovery: () => setPasswordRecovery(false),
    authNotice,
    clearAuthNotice: () => setAuthNotice(null),
    // Swallow-and-log: refresh is fired from onSaved handlers that don't await
    // it, so a rejection here would surface as an unhandled rejection.
    refreshProfile: () => loadProfile(session?.user?.id).catch((e) => logError('auth', e ?? 'profile refresh failed', { op: 'profileRefresh' })),
    signIn, signUp, signOut, sendPasswordReset, updatePassword,
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
