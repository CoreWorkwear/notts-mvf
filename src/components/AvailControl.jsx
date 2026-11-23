import { useEffect, useId, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { haptic } from '../lib/haptics'
import { SPRING_SNAPPY, tap } from '../lib/motion'

// In / Maybe / Can't make it. One tap, optimistic, inline "saved" tick.
// in = green, maybe = amber, out = red (red for "out" is sanctioned in
// DESIGN-SYSTEM §1: red means XL / win / out).
//
// The short tap acknowledges the gesture. Confirm and warning patterns are
// reserved for an actual write outcome; the visible status works on its own.
const OPTIONS = [
  { key: 'in',    label: "I'm in",        short: 'In',    css: 'av-in' },
  { key: 'maybe', label: 'Maybe',         short: 'Maybe', css: 'av-maybe' },
  { key: 'out',   label: "Can't make it", short: 'Out',   css: 'av-out' },
]

export default function AvailControl({ value, pending = false, onChange, compact = false, heading, focusAnswer = false }) {
  const selectionId = useId()
  const reduced = useReducedMotion()
  const [saving, setSaving] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const timer = useRef(null)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; clearTimeout(timer.current) }
  }, [])
  useEffect(() => { if (pending) setFeedback(null) }, [pending])
  const busy = !!saving || pending
  const status = busy ? 'Saving…' : feedback ?? (value ? 'Confirmed' : 'No reply')
  const tone = busy || !value ? 'pending' : value
  // A long diary can contain hundreds of buttons. Only its primary response
  // controls need layout measurement and a spring; compact rows press in CSS.
  const animate = !compact && !reduced
  const Button = animate ? motion.button : 'button'

  async function pick(key, button) {
    if (busy) return
    haptic('tap', button)
    clearTimeout(timer.current)
    setFeedback(null)
    setSaving(key)
    let saved
    try { saved = (await onChange(key)) !== false }
    catch { saved = false }

    if (!saved) haptic('warn', button)
    else if (key === 'in') haptic('confirm', button)
    if (!mounted.current) return
    setSaving(null)
    setFeedback(saved ? 'Saved ✓' : 'Not saved')
    if (saved) timer.current = setTimeout(() => setFeedback(null), 1600)
  }

  return (
    <div className={'avail' + (compact ? ' compact' : '')}>
      <div className="av-head">
        {heading && <strong>{heading}</strong>}
        <span role="status" className={'av-saved lamp-' + (feedback === 'Not saved' && !busy ? 'failed' : tone)}>
          <span aria-hidden="true" className="status-light" />{status}
        </span>
      </div>
      <div className="av-track" role="group" aria-label={heading ?? 'Your availability'}>
        {OPTIONS.map(o => (
          <Button
            key={o.key}
            type="button"
            className={'av-btn ' + o.css + (value === o.key ? ' on' : '')}
            aria-pressed={value === o.key}
            data-sheet-focus={focusAnswer && !busy && (value || 'in') === o.key ? '' : undefined}
            disabled={busy}
            onClick={event => pick(o.key, event.currentTarget)}
            {...(animate ? { whileTap: tap, transition: SPRING_SNAPPY } : {})}
          >
            <span className="av-label">
              {value === o.key && <span aria-hidden="true" className="av-tick">✓</span>}
              {compact ? o.short : o.label}
            </span>
            {value === o.key && (animate
              ? <motion.span aria-hidden="true" className="av-selection" layoutId={selectionId} transition={SPRING_SNAPPY} />
              : <span aria-hidden="true" className="av-selection" />)}
          </Button>
        ))}
      </div>
    </div>
  )
}
