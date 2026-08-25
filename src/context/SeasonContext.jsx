import { createContext, useContext, useCallback, useEffect, useState } from 'react'
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

  const refreshSeasons = useCallback(async () => {
    // A failed seasons fetch leaves seasonId null, which every season-scoped
    // screen would misread as "nothing in the diary" — surface it as an error
    // (with retry via refreshSeasons) rather than rejecting unhandled.
    setError(null)
    try {
      const { data, error: fetchErr } = await supabase.from('seasons').select('*').order('label', { ascending: false })
      if (fetchErr) logError('fetch', fetchErr.message, { hook: 'SeasonContext' })
      const list = data ?? []
      setSeasons(list)
      const current = list.find((s) => s.is_current) ?? list[0]
      setSeasonId((prev) => prev ?? current?.id ?? null)
      return list
    } catch (e) {
      logError('fetch', e?.message ?? 'seasons load failed', { hook: 'SeasonContext' })
      setError(e ?? new Error('load failed'))
      return []
    }
  }, [])

  useEffect(() => {
    if (!isAuthed) { setSeasons([]); setSeasonId(null); setLoading(false); setError(null); return }
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
