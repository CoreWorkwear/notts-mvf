import { useId } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { SPRING_SNAPPY } from '../lib/motion'

export default function TabBar({ tabs, value, onChange, accent = 'var(--red)', className = '' }) {
  const indicator = useId()
  const reduced = useReducedMotion()
  function onKeyDown(e) {
    const i = tabs.findIndex((t) => t.key === value)
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null
    if (next === null) return
    e.preventDefault()
    const index = (next + tabs.length) % tabs.length
    onChange(tabs[index].key)
    e.currentTarget.querySelectorAll('[role="tab"]')[index]?.focus()
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
              <motion.span className="tab-rule" aria-hidden="true" layoutId={reduced ? undefined : indicator}
                transition={SPRING_SNAPPY} style={{ background: accent }} />
            )}
          </button>
        )
      })}
    </div>
  )
}
