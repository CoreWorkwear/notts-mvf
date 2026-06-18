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
        /* Full control (the hero "YOU IN?" bar): a fixed 3-up grid so the row NEVER
           wraps — the long "Can't make it" label wraps inside its own button and all
           three stay equal height. Beats flex-wrap, which dropped the 3rd button to
           its own line on narrow phones. */
        .avail { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; align-items: stretch; }
        .av-btn {
          border: 1px solid var(--line); background: var(--slate); color: var(--bone-mute);
          border-radius: 10px; padding: 8px 6px; font-size: 14px; font-weight: 600;
          min-height: 48px; line-height: 1.15;
          display: flex; align-items: center; justify-content: center; text-align: center;
          transition: transform var(--t-fast), background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
        }
        /* Inline row control (list rows / manager "You"): a compact flex row of short
           In/Maybe/Out buttons, kept at a comfortable 44px touch target. */
        .avail.compact { display: flex; flex-wrap: wrap; gap: 6px; }
        .avail.compact .av-btn { padding: 8px 14px; font-size: 14px; min-width: 46px; min-height: 44px; }
        .av-btn:active { transform: scale(.96); }
        .av-in.on    { background: var(--green-dim-2); border-color: var(--green); color: var(--green-bright); }
        .av-maybe.on { background: var(--amber-dim);   border-color: var(--amber); color: var(--amber); }
        .av-out.on   { background: var(--red-dim-2);   border-color: var(--red);   color: var(--red-bright); }
        .av-saved { grid-column: 1 / -1; font-size: 13px; color: var(--bone-mute); transition: color var(--t-fast); }
        .av-saved.show { color: var(--green-bright); }
        .avail.compact .av-saved { display: none; }
        @keyframes nudge { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-2px)} }
        .avail.pulse .av-btn { animation: nudge 1.6s var(--ease) infinite; border-color: var(--line-2); }
        @media (prefers-reduced-motion: reduce){ .avail.pulse .av-btn{ animation: none } }
      `}</style>
    </div>
  )
}
