import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { logError } from '../lib/logger'

// Roster for the player-facing Squad page (§4.1). DELIBERATELY selects only
// display columns — no email / phone / DOB / emergency contact — so a regular
// member browsing the squad never pulls another player's PII. (The admin Players
// screen uses usePlayers, which does include contact details.)
export function useSquad() {
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: fetchErr } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, positions, preferred, active, approved, is_player, photo_url, team_memberships(teams(key))')
      if (fetchErr) logError('fetch', fetchErr.message, { hook: 'useSquad' })
      setPlayers((data ?? []).map((p) => ({
        ...p,
        teamKeys: (p.team_memberships ?? []).map((m) => m.teams?.key).filter(Boolean),
      })))
    } catch (e) {
      logError('fetch', e?.message ?? 'useSquad load failed', { hook: 'useSquad' })
      setError(e ?? new Error('load failed'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  return { players, loading, error, refetch: load }
}
