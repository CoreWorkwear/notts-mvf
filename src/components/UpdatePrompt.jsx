import { useEffect, useState } from 'react'

// A new service-worker build is ready. We deliberately do NOT auto-reload — that
// interrupted cold starts (the app would hang/flash applying the update on first
// open). Instead this shows a quiet, persistent prompt above the bottom nav; the
// user refreshes when it suits them. Wired from main.jsx via the 'mvf-sw-update'
// event + window.__mvfUpdateSW (which calls the vite-pwa updater → reload).
export default function UpdatePrompt() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const on = () => setReady(true)
    window.addEventListener('mvf-sw-update', on)
    return () => window.removeEventListener('mvf-sw-update', on)
  }, [])
  if (!ready) return null
  return (
    <div className="sw-update" role="status">
      <span className="sw-update-txt">New version ready</span>
      <button className="sw-update-btn" onClick={() => window.__mvfUpdateSW?.()}>Refresh</button>
      <style>{`
        .sw-update {
          position: fixed; left: 50%; transform: translateX(-50%);
          bottom: calc(96px + var(--safe-b)); z-index: 150;
          display: flex; align-items: center; gap: 12px;
          background: var(--coal); border: 1px solid var(--line-2); border-radius: 999px;
          padding: 8px 8px 8px 16px; box-shadow: var(--card-shadow);
          animation: swUpIn var(--t-med) var(--ease);
        }
        .sw-update-txt { font-size: 13px; font-weight: 600; color: var(--bone); white-space: nowrap; }
        .sw-update-btn {
          border: none; background: var(--red); color: #fff; font-weight: 700; font-size: 13px;
          border-radius: 999px; padding: 7px 16px; min-height: 36px;
        }
        @keyframes swUpIn { from { opacity: 0; transform: translate(-50%, 10px) } to { opacity: 1; transform: translate(-50%, 0) } }
        @media (prefers-reduced-motion: reduce){ .sw-update { animation: none } }
      `}</style>
    </div>
  )
}
