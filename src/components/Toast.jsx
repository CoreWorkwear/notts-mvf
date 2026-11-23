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
    <div className={'toast toast-' + tone} role={tone === 'error' ? 'alert' : 'status'}>
      {message}
      {onDismiss && <button type="button" aria-label="Dismiss message" onClick={onDismiss}>×</button>}
    </div>
  )
}
