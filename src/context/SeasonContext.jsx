import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import { logError } from '../lib/logger'

const SeasonContext = createContext(null)

// Scopes the whole app to a season. Defaults to the club's current season;
// the header picker changes it. New fixtures default to the current season.
export function SeasonProvider({ children }) {
  const { isAuthed } = useAuth()
  const [seasons, setSeasons] = useState([])
  const [seasonId, setSeasonId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Latest wins: a seasons fetch still in flight when the user signs out (or a
  // newer refresh starts) must not land afterwards and re-seed the season.
  const reqRef = useRef(0)

  const refreshSeasons = useCallback(async () => {
    const id = ++reqRef.current
    const fresh = () => id === reqRef.current
    // A failed seasons fetch leaves seasonId null, which every season-scoped
    // screen would misread as "nothing in the diary" — surface it as an error
    // (with retry via refreshSeasons) rather than rejecting unhandled.
    setError(null)
    try {
      const { data, error: fetchErr } = await supabase.from('seasons').select('*').order('label', { ascending: false })
      if (!fresh()) return []
      if (fetchErr) throw fetchErr // failed load ≠ no seasons — the catch sets error + retry
      const list = data ?? []
      setSeasons(list)
      const current = list.find((s) => s.is_current) ?? list[0]
      setSeasonId((prev) => prev ?? current?.id ?? null)
      return list
    } catch (e) {
      if (!fresh()) return []
      logError('fetch', e ?? 'seasons load failed', { hook: 'SeasonContext' })
      setError(e ?? new Error('load failed'))
      return []
    }
  }, [])

  useEffect(() => {
    if (!isAuthed) {
      reqRef.current++ // void any fetch still in flight — a signed-out app carries no season
      setSeasons([]); setSeasonId(null); setLoading(false); setError(null)
      return
    }
    let active = true
    refreshSeasons().finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [isAuthed, refreshSeasons])

  const season = seasons.find((s) => s.id === seasonId) ?? null
  return (
    <SeasonContext.Provider value={{ seasons, season, seasonId, setSeasonId, loading, error, refreshSeasons }}>
      {children}
    </SeasonContext.Provider>
  )
}

export const useSeason = () => {
  const ctx = useContext(SeasonContext)
  if (!ctx) throw new Error('useSeason must be used inside <SeasonProvider>')
  return ctx
}
