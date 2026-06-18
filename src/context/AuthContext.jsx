import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { canSetAvailability, accountStatus } from '../lib/players'

const AuthContext = createContext(null)

const MANAGER_VIEW_KEY = 'mvf:managerView'

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [club, setClub] = useState(null) // club row (name, crest_url)
  const [teamKeys, setTeamKeys] = useState([]) // ['xl','community']
  const [loading, setLoading] = useState(true)
  const [passwordRecovery, setPasswordRecovery] = useState(false)
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
    if (!uid) { setProfile(null); setTeamKeys([]); setClub(null); return }
    const [{ data: prof }, { data: memberships }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', uid).single(),
      supabase.from('team_memberships').select('teams(key)').eq('profile_id', uid),
    ])
    setProfile(prof ?? null)
    setTeamKeys((memberships ?? []).map((m) => m.teams?.key).filter(Boolean))
    if (prof?.club_id) {
      const { data: c } = await supabase.from('clubs').select('id, name, crest_url').eq('id', prof.club_id).single()
      setClub(c ?? null)
    } else setClub(null)
  }, [])

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      await loadProfile(data.session?.user?.id)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      // Clicking a reset-password email lands here with a recovery session —
      // flag it so the app shows the set-new-password screen, not the app.
      if (_e === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
      setSession(s)
      await loadProfile(s?.user?.id)
    })
    return () => { active = false; sub.subscription.unsubscribe() }
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

  async function signOut() { return supabase.auth.signOut() }

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
    passwordRecovery,
    endRecovery: () => setPasswordRecovery(false),
    refreshProfile: () => loadProfile(session?.user?.id),
    signIn, signUp, signOut, sendPasswordReset, updatePassword,
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
