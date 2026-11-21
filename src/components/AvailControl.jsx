import { useEffect, useRef, useState } from 'react'
import { haptic } from '../lib/haptics'

// In / Maybe / Can't make it. One tap, optimistic, inline "saved" tick.
// in = green, maybe = amber, out = red (red for "out" is sanctioned in
// DESIGN-SYSTEM §1: red means XL / win / out).
//
// This is THE control of the app — for most of the squad it is the only thing
// they ever touch — so it gets the press physics and the haptic. The buzz fires
// on the WRITE LANDING, not on the tap: the tap is optimistic and can roll back,
// and a phone that buzzed "done" for something that then failed would be lying
// with the one signal the player can feel without looking.
const OPTIONS = [
  { key: 'in',    label: "I'm in",        short: 'In',    css: 'av-in' },
  { key: 'maybe', label: 'Maybe',         short: 'Maybe', css: 'av-maybe' },
  { key: 'out',   label: "Can't make it", short: 'Out',   css: 'av-out' },
]

export default function AvailControl({ value, onChange, compact = false, heading, focusAnswer = false }) {
  const [saving, setSaving] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const status = saving ? 'Saving…' : feedback ?? (value ? 'Confirmed' : 'No reply')
  const tone = saving || !value ? 'pending' : value

  async function pick(key) {
    if (saving) return
    clearTimeout(timer.current)
    setFeedback(null)
    setSaving(key)
    try {
      // onChange resolves `false` (by design, not a throw) when the write
      // failed after retrying — only announce a write that actually landed.
      const ok = await onChange(key)
      if (ok === false) { setFeedback('Not saved'); haptic('warn'); return }
      setFeedback('Saved ✓')
      // Marking yourself in is the good news and gets the fuller pattern; maybe
      // and out are acknowledgements, not celebrations.
      haptic(key === 'in' ? 'confirm' : 'tap')
      timer.current = setTimeout(() => setFeedback(null), 1600)
    } catch {
      setFeedback('Not saved')
      haptic('warn')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className={'avail' + (compact ? ' compact' : '')}>
      {(!compact || feedback || saving) && (
        <div className="av-head">
          {heading && <strong>{heading}</strong>}
          <span role="status" className={'av-saved lamp-' + (feedback === 'Not saved' ? 'failed' : tone)}>
            <span aria-hidden="true" className="status-light" />{status}
          </span>
        </div>
      )}
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          type="button"
          className={'av-btn ' + o.css + (value === o.key ? ' on' : '')}
          aria-pressed={value === o.key}
          data-sheet-focus={focusAnswer && (value || 'in') === o.key ? '' : undefined}
          disabled={!!saving}
          onClick={() => pick(o.key)}
        >
          {value === o.key && <span aria-hidden="true" className="av-tick">✓</span>}
          {compact ? o.short : o.label}
        </button>
      ))}
    </div>
  )
}
