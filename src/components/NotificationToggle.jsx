import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { pushSupported, currentSubscription, enablePush, disablePush } from '../lib/push'
import Toast from './Toast'

// Opt in/out of push (HANDOVER §10). Android/desktop solid; on iOS it only
// works once the app's installed to the home screen (16.4+) and is best-effort.
export default function NotificationToggle() {
  const { user } = useAuth()
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { currentSubscription().then((s) => setOn(!!s)).catch(() => {}) }, [])

  if (!pushSupported) {
    return <p className="dim" style={{ fontSize: 13 }}>This device can’t do notifications.</p>
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
      <button className={'chip' + (on ? ' paid-on' : '')} aria-pressed={on} disabled={busy} onClick={toggle}>
        {busy ? '…' : on ? 'Notifications on ✓' : 'Turn on match notifications'}
      </button>
      <p className="dim" style={{ fontSize: 12, marginTop: 6 }}>
        New games and reminders, with one-tap In/Maybe/Out. On iPhone, add the app to your home screen first.
      </p>
    </div>
  )
}
