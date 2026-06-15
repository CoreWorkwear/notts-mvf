import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Per-club auto-reminder config (one row per club). RLS: club members read,
// admins write. The run-reminders Edge Function reads this server-side hourly.
export function useReminders() {
  const { profile } = useAuth()
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('reminder_settings')
      .select('club_id, availability_enabled, match_enabled, offsets')
      .maybeSingle()
    setSettings(data ?? null)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function save({ availabilityEnabled, matchEnabled, offsets }) {
    const club_id = settings?.club_id ?? profile?.club_id
    if (!club_id) return { error: { message: 'No club found.' } }
    const { error } = await supabase
      .from('reminder_settings')
      .upsert({ club_id, availability_enabled: availabilityEnabled, match_enabled: matchEnabled, offsets }, { onConflict: 'club_id' })
    if (!error) await load()
    return { error }
  }

  return { settings, loading, save, refetch: load }
}
