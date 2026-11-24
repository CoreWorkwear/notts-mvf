import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePaymentsRelease } from '../hooks/usePaymentsRelease'
import { supabase } from '../lib/supabase'

const keyFor = identity => `mvf:account-reminder:${identity}`
function dismissedId(identity) {
  try { return localStorage.getItem(keyFor(identity)) } catch { return null }
}

export default function AccountReminderBanner() {
  const { user, profile } = useAuth()
  const release = usePaymentsRelease(user?.id, profile?.club_id)
  const identity = `${user?.id ?? ''}:${profile?.club_id ?? ''}`
  const allowed = release.enabled && !!user?.id && user.id === profile?.id && profile.is_player && profile.approved && profile.active
  const [snapshot, setSnapshot] = useState(null)
  const [dismissed, setDismissed] = useState(null)
  useEffect(() => {
    if (!allowed) return
    let active = true
    let sequence = 0
    const refresh = () => {
      const request = ++sequence
      Promise.resolve().then(() => supabase.rpc('get_my_account_reminder')).then(({ data, error }) => {
        if (error || (data && (typeof data.id !== 'string' || typeof data.created_at !== 'string'))) throw error ?? new Error('Invalid account reminder')
        if (active && sequence === request) setSnapshot({ identity, notice: data })
      }).catch(() => { if (active && sequence === request) setSnapshot({ identity, notice: null }) })
    }
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    refresh()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => { active = false; window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', onVisible) }
  }, [identity, allowed])
  const latest = snapshot?.identity === identity ? snapshot.notice : null
  if (!allowed || !latest || dismissedId(identity) === latest.id || (dismissed?.identity === identity && dismissed.id === latest.id)) return null
  return <aside className="page" style={{ paddingBottom: 'var(--space-1)' }} aria-label="Account reminder">
    <div className="card col gap-3" style={{ padding: 'var(--space-3)' }}>
      <p>Check your current subs account.</p>
      <Link className="btn btn-ghost btn-block" to="/you">View your account</Link>
      <button className="btn btn-ghost btn-block" onClick={() => {
        try { localStorage.setItem(keyFor(identity), latest.id) } catch { /* The current-session dismissal still works. */ }
        setDismissed({ identity, id: latest.id })
      }}>Dismiss account reminder</button>
    </div>
  </aside>
}
