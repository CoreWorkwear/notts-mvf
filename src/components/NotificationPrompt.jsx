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
        <span className="np-bell" aria-hidden="true">🔔</span>
        <div className="np-text">
          <strong>Get match alerts</strong>
          <span>New fixtures and reminders, one-tap In/Maybe/Out.</span>
        </div>
        <div className="np-actions">
          <button className="btn btn-ghost np-later" onClick={() => setDismissed(true)}>Not now</button>
          <button className="btn btn-primary np-on" disabled={busy} onClick={enable}>{busy ? '…' : 'Turn on'}</button>
        </div>
      </div>
      <style>{`
        .notif-prompt {
          position: fixed; left: 50%; transform: translateX(-50%);
          bottom: calc(var(--nav-h, 64px) + var(--safe-b, 0px) + 10px);
          z-index: 60; width: min(92vw, 460px);
          display: flex; align-items: center; gap: 12px;
          background: var(--coal); border: 1px solid var(--line-2);
          border-left: 3px solid var(--red); border-radius: 14px; padding: 12px 14px;
          box-shadow: 0 16px 38px -12px rgba(0,0,0,.7); animation: npIn var(--t-med) var(--ease);
        }
        .np-bell { font-size: 22px; }
        .np-text { display: flex; flex-direction: column; line-height: 1.25; flex: 1; min-width: 0; }
        .np-text strong { font-size: 14px; }
        .np-text span { font-size: 12px; color: var(--bone-mute); }
        .np-actions { display: flex; gap: 6px; flex: none; }
        .np-later { padding: 8px 10px; font-size: 13px; }
        .np-on { padding: 8px 14px; font-size: 13px; }
        @keyframes npIn { from { opacity: 0; transform: translate(-50%, 10px) } to { opacity: 1; transform: translate(-50%, 0) } }
        @media (prefers-reduced-motion: reduce){ .notif-prompt { animation: none } }
      `}</style>
    </>
  )
}
