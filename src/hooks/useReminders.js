import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { logError } from '../lib/logger'

// Per-club auto-reminder config (one row per club). RLS: club members read,
// admins write. The run-reminders Edge Function reads this server-side hourly.
export function useReminders() {
  const { profile } = useAuth()
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: fetchErr } = await supabase
        .from('reminder_settings')
        .select('club_id, availability_enabled, match_enabled, availability_offsets, match_offsets')
        .maybeSingle()
      if (fetchErr) logError('fetch', fetchErr.message, { hook: 'useReminders' })
      setSettings(data ?? null)
    } catch (e) {
      logError('fetch', e?.message ?? 'useReminders load failed', { hook: 'useReminders' })
      setError(e ?? new Error('load failed'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function save({ availabilityEnabled, matchEnabled, availabilityOffsets, matchOffsets }) {
    const club_id = settings?.club_id ?? profile?.club_id
    if (!club_id) return { error: { message: 'No club found.' } }
    const { error } = await supabase
      .from('reminder_settings')
      .upsert({
        club_id,
        availability_enabled: availabilityEnabled,
        match_enabled: matchEnabled,
        availability_offsets: availabilityOffsets,
        match_offsets: matchOffsets,
      }, { onConflict: 'club_id' })
    if (!error) await load()
    return { error }
  }

  return { settings, loading, error, save, refetch: load }
}
