import { createContext, useContext, useEffect, useState } from 'react'
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

  useEffect(() => {
    if (!isAuthed) { setSeasons([]); setSeasonId(null); setLoading(false); return }
    let active = true
    supabase
      .from('seasons')
      .select('*')
      .order('label', { ascending: false })
      .then(({ data }) => {
        if (!active) return
        const list = data ?? []
        setSeasons(list)
        const current = list.find((s) => s.is_current) ?? list[0]
        setSeasonId((prev) => prev ?? current?.id ?? null)
        setLoading(false)
      })
    return () => { active = false }
  }, [isAuthed])

  const season = seasons.find((s) => s.id === seasonId) ?? null
  return (
    <SeasonContext.Provider value={{ seasons, season, seasonId, setSeasonId, loading }}>
      {children}
    </SeasonContext.Provider>
  )
}

export const useSeason = () => {
  const ctx = useContext(SeasonContext)
  if (!ctx) throw new Error('useSeason must be used inside <SeasonProvider>')
  return ctx
}
