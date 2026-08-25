import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { logError } from '../lib/logger'

// Opponents are club-scoped and persist across seasons (BUILD-LIST A2). Admins
// add/edit; RLS keeps writes admin-only.
export function useOpponents() {
  const { profile } = useAuth()
  const [opponents, setOpponents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: fetchErr } = await supabase
        .from('opponents')
        .select('id, name, badge_url, home_venue, home_address, home_postcode, is_league_team')
        .order('name', { ascending: true })
      if (fetchErr) logError('fetch', fetchErr.message, { hook: 'useOpponents' })
      setOpponents(data ?? [])
    } catch (e) {
      logError('fetch', e?.message ?? 'useOpponents load failed', { hook: 'useOpponents' })
      setError(e ?? new Error('load failed'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const save = useCallback(async ({ id, name, home_venue, home_address, home_postcode, is_league_team, badge_url }) => {
    const row = {
      name: name.trim(),
      home_venue: home_venue?.trim() || null,
      home_address: home_address?.trim() || null,
      home_postcode: home_postcode?.trim().toUpperCase() || null,
      is_league_team: !!is_league_team,
      badge_url: badge_url || null,
    }
    const res = id
      ? await supabase.from('opponents').update(row).eq('id', id)
      : await supabase.from('opponents').insert({ club_id: profile.club_id, ...row })
    if (res.error) throw res.error
    await load()
  }, [profile?.club_id, load])

  return { opponents, loading, error, save, refetch: load }
}
