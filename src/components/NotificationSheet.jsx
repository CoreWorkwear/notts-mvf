import { useEffect, useState } from 'react'
import { enablePush, needsHomeScreen } from '../lib/push'
import Sheet from './Sheet'
import { IconBell } from './Icons'
import '../styles/notifications.css'

export default function NotificationSheet({ open, onClose, onEnabled, profileId }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => { if (open) setError(null) }, [open])
  const install = needsHomeScreen()
  const blocked = window.Notification?.permission === 'denied'

  async function enable() {
    setBusy(true)
    setError(null)
    try {
      // Stay on this click's call stack for the native permission request.
      await enablePush(profileId)
      onEnabled()
    } catch (e) {
      setError(e.message || 'Couldn’t turn on alerts. Try again.')
    } finally { setBusy(false) }
  }

  return (
    <Sheet open={open} onClose={onClose} aria-label="Match alerts">
      <div className="alert-intent">
        <IconBell className="alert-intent-icon" aria-hidden="true" width={32} height={32} />
        <h2 className="display">{install ? 'Add Notts MvF to your Home Screen' : 'Match alerts'}</h2>
        {install ? <>
          <p>Install the app to get matchday alerts on this device.</p>
          <ol className="alert-install-steps">
            <li>
              <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 15V3m-4 4 4-4 4 4M7.5 10H5v11h14V10h-2.5" />
              </svg>
              <span>Open the browser menu and tap <strong>Share</strong>.</span>
            </li>
            <li>
              <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="4" /><path d="M12 7.5v9m-4.5-4.5h9" />
              </svg>
              <span>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</span>
            </li>
          </ol>
          <p>Open <strong>Notts MvF</strong> from your Home Screen. In <strong>You</strong>, turn on <strong>Match alerts</strong>.</p>
        </> : blocked ? (
          <p>Allow notifications for Notts MvF in your browser or device settings, then return here to turn on match alerts.</p>
        ) : (
          <p>Get the line-up as soon as it's named, and a reminder before kick-off.</p>
        )}
        {error && !blocked && <p role="alert" className="field-error">{error}</p>}
        {install || blocked ? <button className="btn btn-ghost" onClick={onClose}>Got it</button> : <>
          <button className="btn btn-primary" disabled={busy} aria-busy={busy} onClick={enable}>
            {busy ? 'Turning on…' : 'Enable match alerts'}
          </button>
          <button className="btn btn-ghost" disabled={busy} onClick={onClose}>Not now</button>
        </>}
      </div>
    </Sheet>
  )
}
