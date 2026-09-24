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
      if (fetchErr) throw fetchErr // failed load ≠ no news — catch keeps data + sets error
      setItems(data ?? [])
    } catch (e) {
      logError('fetch', e ?? 'useNews load failed', { hook: 'useNews' })
      setError(e ?? new Error('load failed'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Post a news item; if push, broadcast it to everyone's devices too. Resolves
  // { pushFailed } so the composer can say "posted, but the push didn't go out".
  // The row goes in with pushed:false and is only flagged once the push has
  // actually gone out — the 🔔 badge must not lie. A failed push is non-fatal
  // (the news is posted) but is logged and reported, never swallowed.
  const post = useCallback(async ({ title, body, push }) => {
    const t = title.trim(), b = body.trim()
    const { data, error } = await supabase.from('announcements')
      .insert({ club_id: profile.club_id, created_by: user.id, title: t, body: b, pushed: false })
      .select('id')
      .single()
    if (error) throw error
    let pushFailed = false
    if (push) {
      // functions.invoke resolves { error } rather than throwing (a network-level
      // failure comes back as a FunctionsFetchError in `error` too).
      let pushErr = null
      try { ({ error: pushErr } = await supabase.functions.invoke('send-push', { body: { title: t, body: b, url: '/news' } })) }
      catch (e) { pushErr = e ?? new Error('push failed') }
      if (pushErr) {
        pushFailed = true
        logError('push', pushErr, { hook: 'useNews', op: 'post', announcementId: data?.id ?? null })
      } else if (data?.id) {
        const { error: flagErr } = await supabase.from('announcements').update({ pushed: true }).eq('id', data.id)
        if (flagErr) logError('write', flagErr, { hook: 'useNews', op: 'post.pushed', announcementId: data.id })
      }
    }
    await load()
    return { pushFailed }
  }, [profile?.club_id, user?.id, load])

  const remove = useCallback(async (id) => {
    const { error } = await supabase.from('announcements').delete().eq('id', id)
    if (error) throw error
    await load()
  }, [load])

  return { items, loading, error, post, remove, refetch: load }
}
