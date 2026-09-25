import { motion } from 'framer-motion'
import { indicatorTransition } from '../lib/motion'

// A real tab bar: labels with a single underline that slides from the old tab to
// the new one. Replaces the row of fat filled buttons we were using as a
// segmented control — four competing primary buttons read as four CTAs, which is
// exactly wrong for what is only a view switch.
//
// The slide is one shared `layoutId`, so Framer tweens the indicator's box
// between positions instead of hiding it here and showing it there. Under
// reduced motion the app-level <MotionConfig reducedMotion="user"> drops it to
// an instant jump.
//
// tabs: [{ key, label }]. `accent` picks the underline colour so a Community
// context can carry green.
export default function TabBar({ tabs, value, onChange, id, accent = 'var(--red)', className = '' }) {
  function onKeyDown(e) {
    const i = tabs.findIndex((t) => t.key === value)
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null
    if (next === null) return
    e.preventDefault()
    onChange(tabs[(next + tabs.length) % tabs.length].key)
  }

  return (
    <div className={'tabbar ' + className} role="tablist" onKeyDown={onKeyDown}>
      {tabs.map((t) => {
        const on = t.key === value
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            className={'tab' + (on ? ' on' : '')}
            onClick={() => onChange(t.key)}
          >
            <span className="tab-label">{t.label}</span>
            {t.count != null && <span className="tab-count mono">{t.count}</span>}
            {on && (
              <motion.span
                className="tab-rule"
                layoutId={`tab-rule-${id}`}
                transition={indicatorTransition}
                style={{ background: accent }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
