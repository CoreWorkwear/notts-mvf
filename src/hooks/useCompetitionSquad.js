import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { logError } from '../lib/logger'

// The registered squad for one competition (§2). season_id is filled server-side
// by the competition_squad_guard trigger; the cap is enforced there too, so add()
// can return a "squad full" error which the UI surfaces.
export function useCompetitionSquad(competitionId) {
  const [registered, setRegistered] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!competitionId) { setRegistered(new Set()); setLoading(false); setError(null); return }
    setLoading(true)
    setError(null)
    try {
      const { data, error: fetchErr } = await supabase
        .from('competition_squads').select('profile_id').eq('competition_id', competitionId)
      if (fetchErr) logError('fetch', fetchErr.message, { hook: 'useCompetitionSquad', competitionId })
      setRegistered(new Set((data ?? []).map((r) => r.profile_id)))
    } catch (e) {
      logError('fetch', e?.message ?? 'useCompetitionSquad load failed', { hook: 'useCompetitionSquad', competitionId })
      setError(e ?? new Error('load failed'))
    } finally {
      setLoading(false)
    }
  }, [competitionId])

  useEffect(() => { load() }, [load])

  async function add(profileId) {
    const res = await supabase.from('competition_squads').insert({ competition_id: competitionId, profile_id: profileId })
    if (res.error) logError('write', res.error.message, { op: 'squad.add', competitionId })
    else setRegistered((s) => new Set(s).add(profileId))
    return res
  }
  async function remove(profileId) {
    const res = await supabase.from('competition_squads').delete()
      .eq('competition_id', competitionId).eq('profile_id', profileId)
    if (res.error) logError('write', res.error.message, { op: 'squad.remove', competitionId })
    else setRegistered((s) => { const n = new Set(s); n.delete(profileId); return n })
    return res
  }

  return { registered, count: registered.size, loading, error, refetch: load, add, remove }
}
