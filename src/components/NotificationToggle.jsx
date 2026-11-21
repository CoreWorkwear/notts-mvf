import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { pushSupported, currentSubscription, enablePush, disablePush } from '../lib/push'
import Toast from './Toast'

// Opt in/out of push (HANDOVER §10). Android/desktop solid; on iOS it only
// works once the app's installed to the home screen (16.4+) and is best-effort.
export default function NotificationToggle() {
  const { user } = useAuth()
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // "On" means the server can actually reach this device FOR THIS USER: a
  // browser subscription alone isn't enough — it can belong to a previous
  // user on a shared phone, or its push_tokens row may have been pruned
  // after delivery failures. Both used to show a lying "Notifications on ✓".
  useEffect(() => {
    let active = true
    ;(async () => {
      const s = await currentSubscription()
      if (!s || !user?.id) { if (active) setOn(false); return }
      const { data } = await supabase
        .from('push_tokens').select('id').eq('profile_id', user.id).eq('token', JSON.stringify(s)).maybeSingle()
      if (active) setOn(!!data)
    })().catch(() => {})
    return () => { active = false }
  }, [user?.id])

  if (!pushSupported) {
    return <p className="dim" style={{ fontSize: 'var(--type-sm)' }}>Match alerts aren’t available in this browser.</p>
  }

  async function toggle() {
    setBusy(true); setError(null)
    try {
      if (on) { await disablePush(user.id); setOn(false) }
      else { await enablePush(user.id); setOn(true) }
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <div>
      <Toast message={error} onDismiss={() => setError(null)} />
      <button className="chip" aria-pressed={on} aria-busy={busy} aria-describedby="alert-help" disabled={busy} onClick={toggle}>
        Match alerts <span aria-hidden="true">· {busy ? 'Updating…' : on ? 'On' : 'Off'}</span>
      </button>
      <p className="dim" id="alert-help" style={{ fontSize: 'var(--type-caption)', marginTop: 'var(--space-1)' }}>
        New fixtures and reminders
      </p>
    </div>
  )
}
