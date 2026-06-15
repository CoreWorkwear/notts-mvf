import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Full squad records for the admin Players screen. RLS lets an admin select
// every profile in the club; team memberships come along for the ride.
export function usePlayers() {
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, email, phone, dob, ec_name, ec_phone, positions, preferred, role, xl_eligible, active, approved, is_player, photo_url, team_memberships(team_id, teams(key, label))')
      .order('last_name', { ascending: true })

    setPlayers((data ?? []).map((p) => ({
      ...p,
      teamKeys: (p.team_memberships ?? []).map((m) => m.teams?.key).filter(Boolean),
      teamIds: (p.team_memberships ?? []).map((m) => m.team_id),
    })))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return { players, loading, refetch: load }
}
