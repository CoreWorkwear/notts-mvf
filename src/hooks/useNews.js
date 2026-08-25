import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { logError } from '../lib/logger'

// Club news/announcements. Everyone in the club reads; admins post (RLS).
// Posting can optionally broadcast a push via the send-push Edge Function.
export function useNews() {
  const { profile, user } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: fetchErr } = await supabase
        .from('announcements')
        .select('id, title, body, pushed, created_at, author:profiles!announcements_created_by_fkey(first_name, last_name)')
        .order('created_at', { ascending: false })
      if (fetchErr) logError('fetch', fetchErr.message, { hook: 'useNews' })
      setItems(data ?? [])
    } catch (e) {
      logError('fetch', e?.message ?? 'useNews load failed', { hook: 'useNews' })
      setError(e ?? new Error('load failed'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Post a news item; if push, broadcast it to everyone's devices too.
  const post = useCallback(async ({ title, body, push }) => {
    const { error } = await supabase.from('announcements').insert({
      club_id: profile.club_id, created_by: user.id,
      title: title.trim(), body: body.trim(), pushed: !!push,
    })
    if (error) throw error
    if (push) {
      // Non-fatal: a failed push shouldn't lose the posted news.
      try { await supabase.functions.invoke('send-push', { body: { title: title.trim(), body: body.trim(), url: '/news' } }) } catch {}
    }
    await load()
  }, [profile?.club_id, user?.id, load])

  const remove = useCallback(async (id) => {
    const { error } = await supabase.from('announcements').delete().eq('id', id)
    if (error) throw error
    await load()
  }, [load])

  return { items, loading, error, post, remove, refetch: load }
}
