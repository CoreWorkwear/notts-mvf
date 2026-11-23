import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { pushSupported, needsHomeScreen } from '../lib/push'
import NotificationSheet from './NotificationSheet'

// Low-friction opt-in nudge (§3.6). Shows only while the browser permission is
// still 'default' — never once granted or denied — so it re-asks on each app
// open. Not a blocking modal; "Not now" hides it for the rest of this session.
export default function NotificationPrompt() {
  const { user, holding } = useAuth()
  const key = 'mvf:alert-nudge:' + user?.id
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(key) === 'later' } catch { return false }
  })
  const [open, setOpen] = useState(false)
  const canAsk = needsHomeScreen() || (pushSupported && window.Notification?.permission === 'default')
  if (!user || holding || (!canAsk && !open) || dismissed) return null

  function later() {
    setOpen(false)
    setDismissed(true)
    try { sessionStorage.setItem(key, 'later') } catch { /* The nudge is still dismissed on this screen. */ }
  }

  return (
    <>
      <div className="notif-prompt" role="region" aria-label="Turn on notifications">
        <div className="np-text">
          <strong>Match alerts</strong>
        </div>
        <div className="np-actions">
          <button className="btn btn-ghost np-later" onClick={later}>Not now</button>
          <button className="btn btn-primary np-on" onClick={() => setOpen(true)}>Turn on</button>
        </div>
      </div>
      <NotificationSheet open={open} onClose={later} onEnabled={later} profileId={user.id} />
      <style>{`
        .notif-prompt {
          display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3);
          margin-block: var(--space-3); padding: var(--space-3);
          background: var(--surface-raised); border: 1px solid var(--border); border-radius: var(--r-input);
        }
        .np-text { display: flex; flex-direction: column; line-height: 1.25; flex: 1 1 9rem; min-width: 0; }
        .np-text strong { font-size: var(--type-sm); }
        .np-actions { display: flex; gap: var(--space-1); flex: none; }
        .np-later { padding: var(--space-2) var(--space-2); font-size: var(--type-sm); }
        .np-on { padding: var(--space-2) var(--space-3); font-size: var(--type-sm); }
        @media (prefers-reduced-motion: reduce){ .notif-prompt { animation: none } }
      `}</style>
    </>
  )
}
