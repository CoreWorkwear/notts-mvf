import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [teamKeys, setTeamKeys] = useState([]) // ['xl','community']
  const [loading, setLoading] = useState(true)

  // Pull the profile row + team memberships for the signed-in user.
  const loadProfile = useCallback(async (uid) => {
    if (!uid) { setProfile(null); setTeamKeys([]); return }
    const [{ data: prof }, { data: memberships }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', uid).single(),
      supabase.from('team_memberships').select('teams(key)').eq('profile_id', uid),
    ])
    setProfile(prof ?? null)
    setTeamKeys((memberships ?? []).map((m) => m.teams?.key).filter(Boolean))
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
      setSession(s)
      await loadProfile(s?.user?.id)
    })
    return () => { active = false; sub.subscription.unsubscribe() }
  }, [loadProfile])

  // --- auth actions -------------------------------------------------------
  async function signIn(email, password) {
    return supabase.auth.signInWithPassword({ email, password })
  }

  // Register writes the trigger metadata. Server forces player/not-eligible.
  async function signUp({ email, password, first_name, last_name, phone, positions, preferred, teams }) {
    return supabase.auth.signUp({
      email,
      password,
      options: { data: { first_name, last_name, phone, positions, preferred, teams } },
    })
  }

  async function signOut() { return supabase.auth.signOut() }

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    teamKeys,
    loading,
    isAuthed: !!session,
    isAdmin: profile?.role === 'admin',
    xlEligible: !!profile?.xl_eligible,
    refreshProfile: () => loadProfile(session?.user?.id),
    signIn, signUp, signOut,
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
