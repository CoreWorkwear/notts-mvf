import { motion } from 'framer-motion'
import { indicatorTransition } from '../lib/motion'

// A segmented control for a switch between mutually exclusive views: a recessed
// track with one raised thumb that slides to the chosen segment.
//
// This replaces rows of saturated rounded pills. A pill filled with brand colour
// reads as "this is the action" — so three of them side by side read as three
// competing actions, when all they do is change which list you're looking at.
// Here the brand colour is spent on the primary CTA instead, and the control
// says what it is through shape and elevation.
//
// The thumb is one shared layoutId per control, so it travels between segments.
// `options`: [{ key, label }]. `accent` tints the active label where the choice
// carries team colour (red = First Team, green = Community).
export default function Segmented({ options, value, onChange, id, className = '', size = 'md' }) {
  function onKeyDown(e) {
    const i = options.findIndex((o) => o.key === value)
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null
    if (next === null) return
    e.preventDefault()
    onChange(options[(next + options.length) % options.length].key)
  }

  return (
    <div className={`seg seg-${size} ${className}`} role="tablist" onKeyDown={onKeyDown}>
      {options.map((o) => {
        const on = o.key === value
        return (
          <button
            key={o.key}
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            className={'seg-item' + (on ? ' on' : '') + (o.accent ? ` accent-${o.accent}` : '')}
            onClick={() => onChange(o.key)}
          >
            {on && (
              <motion.span className="seg-thumb" layoutId={`seg-thumb-${id}`} transition={indicatorTransition} />
            )}
            <span className="seg-label">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
