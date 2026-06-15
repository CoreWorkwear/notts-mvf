import { createContext, useContext, useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const SeasonContext = createContext(null)

// Scopes the whole app to a season. Defaults to the club's current season;
// the header picker changes it. New fixtures default to the current season.
export function SeasonProvider({ children }) {
  const { isAuthed } = useAuth()
  const [seasons, setSeasons] = useState([])
  const [seasonId, setSeasonId] = useState(null)
  const [loading, setLoading] = useState(true)

  const refreshSeasons = useCallback(async () => {
    const { data } = await supabase.from('seasons').select('*').order('label', { ascending: false })
    const list = data ?? []
    setSeasons(list)
    const current = list.find((s) => s.is_current) ?? list[0]
    setSeasonId((prev) => prev ?? current?.id ?? null)
    return list
  }, [])

  useEffect(() => {
    if (!isAuthed) { setSeasons([]); setSeasonId(null); setLoading(false); return }
    let active = true
    refreshSeasons().finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [isAuthed, refreshSeasons])

  const season = seasons.find((s) => s.id === seasonId) ?? null
  return (
    <SeasonContext.Provider value={{ seasons, season, seasonId, setSeasonId, loading, refreshSeasons }}>
      {children}
    </SeasonContext.Provider>
  )
}

export const useSeason = () => {
  const ctx = useContext(SeasonContext)
  if (!ctx) throw new Error('useSeason must be used inside <SeasonProvider>')
  return ctx
}
