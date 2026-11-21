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
      <span className="sw-update-txt">Update ready</span>
      <button className="sw-update-btn" onClick={() => window.__mvfUpdateSW?.()}>Refresh</button>
      <style>{`
        .sw-update {
          position: fixed; left: max(var(--gutter), var(--safe-l)); right: max(var(--gutter), var(--safe-r));
          margin-inline: auto; width: fit-content; max-width: 100%;
          bottom: calc(var(--nav-height, var(--safe-b)) + var(--space-3)); z-index: 60;
          display: flex; align-items: center; gap: var(--space-3);
          background: var(--coal); border: 1px solid var(--line-2); border-radius: 999px;
          padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4); box-shadow: var(--card-shadow);
          animation: swUpIn var(--t-med);
        }
        .sw-update-txt { font-size: var(--type-sm); font-weight: 600; color: var(--bone);  }
        .sw-update-btn {
          border: none; background: var(--action-fill); color: var(--on-action); font-weight: 700; font-size: var(--type-sm);
          border-radius: 999px; padding: var(--space-2) var(--space-4); min-height: var(--target);
        }
        @keyframes swUpIn { from { opacity: 0; transform: translateY(var(--space-2)) } to { opacity: 1; transform: none } }
        @media (prefers-reduced-motion: reduce){ .sw-update { animation: none } }
      `}</style>
    </div>
  )
}
