import { useSyncExternalStore } from 'react'
import { acceptUpdate, getUpdateStatus, subscribeToUpdate } from '../lib/pwaUpdate'

export default function UpdatePrompt() {
  const status = useSyncExternalStore(subscribeToUpdate, getUpdateStatus)
  if (status === 'current') return null
  return (
    <div className="sw-update" role="status">
      <span className="sw-update-txt">{status === 'ready' ? 'Update ready' : 'Updating…'}</span>
      <button className="sw-update-btn" disabled={status !== 'ready'} onClick={acceptUpdate}>Refresh</button>
      <style>{`
        html { scroll-padding-bottom: calc(var(--nav-height, 0px) + var(--safe-b) + var(--nav-gap) + var(--target) + var(--space-8)); }
        main .page { padding-bottom: calc(var(--nav-height, var(--space-16)) + var(--safe-b) + var(--nav-gap) + var(--target) + var(--space-10)); }
        .sw-update {
          position: fixed; left: max(var(--gutter), var(--safe-l)); right: max(var(--gutter), var(--safe-r));
          margin-inline: auto; width: fit-content; max-width: 100%;
          bottom: calc(var(--nav-height, 0px) + var(--safe-b) + var(--nav-gap) + var(--space-3)); z-index: 60;
          display: flex; align-items: center; gap: var(--space-3); pointer-events: none;
          background: var(--coal); border: 1px solid var(--line-2); border-radius: 999px;
          padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4); box-shadow: var(--card-shadow);
          animation: swUpIn var(--t-med);
        }
        .sw-update-txt { font-size: var(--type-sm); font-weight: 600; color: var(--bone);  }
        .sw-update-btn {
          pointer-events: auto;
          border: none; background: var(--action-fill); color: var(--on-action); font-weight: 700; font-size: var(--type-sm);
          border-radius: 999px; padding: var(--space-2) var(--space-4); min-height: var(--target);
        }
        @keyframes swUpIn { from { opacity: 0; transform: translateY(var(--space-2)) } to { opacity: 1; transform: none } }
        @media (prefers-reduced-motion: reduce){ .sw-update { animation: none } }
      `}</style>
    </div>
  )
}
