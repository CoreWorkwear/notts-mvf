import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { logError } from '../lib/logger'

// Full squad records for the admin Players screen. RLS lets an admin select
// every profile in the club; team memberships come along for the ride.
export function usePlayers() {
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: fetchErr } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, email, phone, dob, ec_name, ec_phone, positions, preferred, role, active, approved, is_player, photo_url, team_memberships(team_id, teams(key, label))')
        .order('last_name', { ascending: true })
      if (fetchErr) logError('fetch', fetchErr.message, { hook: 'usePlayers' })

      setPlayers((data ?? []).map((p) => ({
        ...p,
        teamKeys: (p.team_memberships ?? []).map((m) => m.teams?.key).filter(Boolean),
        teamIds: (p.team_memberships ?? []).map((m) => m.team_id),
      })))
    } catch (e) {
      logError('fetch', e?.message ?? 'usePlayers load failed', { hook: 'usePlayers' })
      setError(e ?? new Error('load failed'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return { players, loading, error, refetch: load }
}
