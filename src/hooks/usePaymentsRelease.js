import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// The server owns release and cutover state. A paused release never brings the
// old per-match payment controls back after cutover.
export function usePaymentsRelease(userId, clubId) {
  const identity = `${userId ?? ''}:${clubId ?? ''}`
  const [state, setState] = useState({ identity, enabled: false, cutover_at: null, loading: !!supabase.rpc, error: false })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!supabase.rpc) return
    let active = true
    setState(s => ({ ...(s.identity === identity ? s : { enabled: false, cutover_at: null }), identity, loading: true, error: false }))
    Promise.resolve().then(() => supabase.rpc('payments_release_status')).then(({ data, error }) => {
      if (error || typeof data?.enabled !== 'boolean') throw error ?? new Error('Missing release status')
      if (active) setState({ ...data, identity, loading: false, error: false })
    }).catch(() => { if (active) setState(s => ({ ...s, enabled: false, loading: false, error: true })) })
    return () => { active = false }
  }, [attempt, identity])
  useEffect(() => {
    const refresh = () => setAttempt(a => a + 1)
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', onVisible) }
  }, [])
  const current = state.identity === identity ? state : { enabled: false, cutover_at: null, loading: true, error: false }
  return { ...current, retry: () => setAttempt(a => a + 1) }
}
