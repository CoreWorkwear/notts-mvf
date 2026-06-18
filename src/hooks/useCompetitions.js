import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { competitionPayload } from '../lib/competitions'
import { logError } from '../lib/logger'

// Competitions for a season (§1.5). Club-scoped + admin-write by RLS.
export function useCompetitions(seasonId) {
  const { profile } = useAuth()
  const [competitions, setCompetitions] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!seasonId) { setCompetitions([]); setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase
      .from('competitions')
      .select('id, name, type, season_id, squad_limit_enabled, squad_limit')
      .eq('season_id', seasonId)
      .order('name')
    if (error) logError('fetch', error.message, { hook: 'useCompetitions', seasonId })
    setCompetitions(data ?? [])
    setLoading(false)
  }, [seasonId])

  useEffect(() => { load() }, [load])

  async function save(comp) {
    const club_id = profile?.club_id
    if (!club_id || !seasonId) return { error: { message: 'No club/season.' } }
    const payload = { club_id, season_id: seasonId, ...competitionPayload(comp) }
    const res = comp.id
      ? await supabase.from('competitions').update(payload).eq('id', comp.id)
      : await supabase.from('competitions').insert(payload)
    if (!res.error) await load()
    return res
  }

  async function remove(id) {
    const res = await supabase.from('competitions').delete().eq('id', id)
    if (!res.error) await load()
    return res
  }

  return { competitions, loading, refetch: load, save, remove }
}
