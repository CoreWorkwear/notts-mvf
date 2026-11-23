import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { pushSupported, enablePush } from '../lib/push'
import Toast from './Toast'

// Low-friction opt-in nudge (§3.6). Shows only while the browser permission is
// still 'default' — never once granted or denied — so it re-asks on each app
// open. Not a blocking modal; "Not now" hides it for the rest of this session.
export default function NotificationPrompt() {
  const { user } = useAuth()
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const canAsk = pushSupported && typeof Notification !== 'undefined' && Notification.permission === 'default'
  if (!user || !canAsk || dismissed) return null

  async function enable() {
    setBusy(true); setError(null)
    try { await enablePush(user.id); setDismissed(true) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <>
      <Toast message={error} onDismiss={() => setError(null)} />
      <div className="notif-prompt" role="region" aria-label="Turn on notifications">
        <div className="np-text">
          <strong>Match alerts</strong>
        </div>
        <div className="np-actions">
          <button className="btn btn-ghost np-later" onClick={() => setDismissed(true)}>Not now</button>
          <button className="btn btn-primary np-on" disabled={busy} onClick={enable}>{busy ? '…' : 'Turn on'}</button>
        </div>
      </div>
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
