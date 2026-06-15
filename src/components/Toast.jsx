import { useEffect, useRef } from 'react'

// A prominent pop-up error/notice that slides in over everything (above sheets)
// and auto-dismisses. Tap to dismiss early. role="alert" so it's announced.
export default function Toast({ message, onDismiss, tone = 'error' }) {
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss

  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => dismiss.current?.(), 4000)
    return () => clearTimeout(t)
  }, [message])

  if (!message) return null
  return (
    <div className={'toast toast-' + tone} role="alert" onClick={() => onDismiss?.()}>
      {message}
      <style>{`
        .toast {
          position: fixed; left: 50%; top: calc(14px + var(--safe-t)); transform: translateX(-50%);
          z-index: 200; max-width: 92vw; padding: 13px 18px; border-radius: 12px;
          font-weight: 600; font-size: 15px; color: #fff; cursor: pointer;
          box-shadow: 0 16px 38px -10px rgba(0,0,0,.7);
          animation: toastIn var(--t-med) var(--ease);
        }
        .toast-error  { background: var(--red); border: 1px solid var(--red-bright); }
        .toast-success{ background: var(--green); border: 1px solid var(--green-bright); }
        @keyframes toastIn { from { opacity: 0; transform: translate(-50%, -14px) } to { opacity: 1; transform: translate(-50%, 0) } }
        @media (prefers-reduced-motion: reduce){ .toast { animation: none } }
      `}</style>
    </div>
  )
}
