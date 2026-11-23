import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { pushSupported, needsHomeScreen, currentSubscription, disablePush } from '../lib/push'
import NotificationSheet from './NotificationSheet'
import Toast from './Toast'

// Opt in/out of push (HANDOVER §10). Android/desktop solid; on iOS it only
// works once the app's installed to the home screen (16.4+) and is best-effort.
export default function NotificationToggle() {
  const { user } = useAuth()
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(false)
  const localChange = useRef(0)
  const installFirst = needsHomeScreen()

  // "On" means the server can actually reach this device FOR THIS USER: a
  // browser subscription alone isn't enough — it can belong to a previous
  // user on a shared phone, or its push_tokens row may have been pruned
  // after delivery failures. Both used to show a lying "Notifications on ✓".
  useEffect(() => {
    if (installFirst) return
    let active = true
    const version = localChange.current
    ;(async () => {
      const s = await currentSubscription()
      if (!s || !user?.id) { if (active && version === localChange.current) setOn(false); return }
      const { data } = await supabase
        .from('push_tokens').select('id').eq('profile_id', user.id).eq('token', JSON.stringify(s)).maybeSingle()
      if (active && version === localChange.current) setOn(!!data)
    })().catch(() => {})
    return () => { active = false }
  }, [user?.id, installFirst])

  if (!pushSupported && !installFirst) {
    return <p className="dim" style={{ fontSize: 'var(--type-sm)' }}>Match alerts aren’t available in this browser.</p>
  }

  async function toggle() {
    if (installFirst || !on) { setOpen(true); return }
    setBusy(true); setError(null)
    try {
      await disablePush(user.id); localChange.current++; setOn(false)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <div>
      <Toast message={error} onDismiss={() => setError(null)} />
      <button className="chip" aria-pressed={installFirst ? undefined : on} aria-haspopup={installFirst || !on ? 'dialog' : undefined}
        aria-busy={busy} aria-describedby="alert-help" disabled={busy} onClick={toggle}>
        {installFirst ? 'Set up match alerts' : <>Match alerts <span aria-hidden="true">· {busy ? 'Updating…' : on ? 'On' : 'Off'}</span></>}
      </button>
      <p className="dim" id="alert-help" style={{ fontSize: 'var(--type-caption)', marginTop: 'var(--space-1)' }}>
        {installFirst ? 'Add to your Home Screen for line-ups and kick-off reminders.' : 'Line-ups and kick-off reminders'}
      </p>
      <NotificationSheet open={open} onClose={() => setOpen(false)} onEnabled={() => { localChange.current++; setOn(true); setOpen(false) }} profileId={user.id} />
    </div>
  )
}
