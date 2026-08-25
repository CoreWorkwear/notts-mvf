import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { firstRow } from '../lib/embed'
import { logError } from '../lib/logger'

// Full squad records for the admin Players screen. RLS lets an admin select
// every profile in the club; team memberships come along for the ride. The
// PII (email/phone/dob/emergency contact) lives in profile_private — its RLS
// is self-or-admin, so this embed only resolves for admins — and is flattened
// here so PlayerForm keeps its flat player shape.
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
        .select('id, first_name, last_name, positions, preferred, role, active, approved, is_player, photo_url, profile_private(email, phone, dob, ec_name, ec_phone), team_memberships(team_id, teams(key, label))')
        .order('last_name', { ascending: true })
      if (fetchErr) logError('fetch', fetchErr.message, { hook: 'usePlayers' })

      setPlayers((data ?? []).map((p) => {
        const priv = firstRow(p.profile_private) ?? {}
        return {
          ...p,
          email: priv.email ?? null, phone: priv.phone ?? null, dob: priv.dob ?? null,
          ec_name: priv.ec_name ?? null, ec_phone: priv.ec_phone ?? null,
          teamKeys: (p.team_memberships ?? []).map((m) => m.teams?.key).filter(Boolean),
          teamIds: (p.team_memberships ?? []).map((m) => m.team_id),
        }
      }))
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
