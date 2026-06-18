import { useState } from 'react'

// In / Maybe / Can't make it. One tap, optimistic, inline "saved" tick.
// in = green, maybe = amber, out = red (red for "out" is sanctioned in
// DESIGN-SYSTEM §1: red means XL / win / out).
const OPTIONS = [
  { key: 'in',    label: "I'm in",        short: 'In',    css: 'av-in' },
  { key: 'maybe', label: 'Maybe',         short: 'Maybe', css: 'av-maybe' },
  { key: 'out',   label: "Can't make it", short: 'Out',   css: 'av-out' },
]

export default function AvailControl({ value, onChange, compact = false, unanswered = false }) {
  const [saving, setSaving] = useState(null)
  const [justSaved, setJustSaved] = useState(false)

  async function pick(key) {
    if (saving) return
    setSaving(key)
    try {
      await onChange(key)
      setJustSaved(true)
      if (navigator.vibrate && key === 'in') navigator.vibrate(8) // haptic tick, Android
      setTimeout(() => setJustSaved(false), 1600)
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className={'avail' + (compact ? ' compact' : '') + (unanswered && !value ? ' pulse' : '')}>
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          className={'av-btn ' + o.css + (value === o.key ? ' on' : '')}
          aria-pressed={value === o.key}
          disabled={!!saving}
          onClick={() => pick(o.key)}
        >
          {saving === o.key ? '…' : compact ? o.short : o.label}
        </button>
      ))}
      {!compact && (
        <span className={'av-saved' + (justSaved ? ' show' : '')}>
          {justSaved ? 'Saved ✓' : value ? `You're down as ${OPTIONS.find((o) => o.key === value)?.short}` : 'Not answered yet'}
        </span>
      )}

      <style>{`
        .avail { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .avail.compact { gap: 6px; }
        .av-btn {
          border: 1px solid var(--line); background: var(--slate); color: var(--bone-mute);
          border-radius: 10px; padding: 11px 14px; font-size: 15px; font-weight: 600;
          transition: transform var(--t-fast), background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
          flex: 1; min-width: 92px;
        }
        /* Inline row control: still compact, but a comfortable 44px touch target
           for the player's most-used action (was ~32px). */
        .avail.compact .av-btn { flex: none; padding: 8px 14px; font-size: 14px;
          min-width: 46px; min-height: 44px; }
        .av-btn:active { transform: scale(.96); }
        .av-in.on    { background: var(--green-dim-2); border-color: var(--green); color: var(--green-bright); }
        .av-maybe.on { background: var(--amber-dim);   border-color: var(--amber); color: var(--amber); }
        .av-out.on   { background: var(--red-dim-2);   border-color: var(--red);   color: var(--red-bright); }
        .av-saved { width: 100%; font-size: 13px; color: var(--bone-mute); transition: color var(--t-fast); }
        .av-saved.show { color: var(--green-bright); }
        .avail.compact .av-saved { display: none; }
        @keyframes nudge { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-2px)} }
        .avail.pulse .av-btn { animation: nudge 1.6s var(--ease) infinite; border-color: var(--line-2); }
        @media (prefers-reduced-motion: reduce){ .avail.pulse .av-btn{ animation: none } }
      `}</style>
    </div>
  )
}
