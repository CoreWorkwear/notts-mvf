import { useEffect, useRef, useState } from 'react'
import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion } from 'framer-motion'
import { SPRING_SNAPPY } from '../lib/motion'
import '../styles/notifications.css'

const actionText = { lineup: 'View line-up', avail: 'Confirm availability', match: 'View fixture', news: 'Read club news', training: 'View training session' }

export default function ForegroundAlert({ alert, onDismiss, onOpen }) {
  const reduce = useReducedMotion()
  const [reading, setReading] = useState(false)
  const press = useRef(null)
  const suppressClick = useRef(false)
  const y = useMotionValue(0)
  useEffect(() => {
    if (!alert) { setReading(false); return }
    if (reading) return
    const timer = setTimeout(onDismiss, 9000)
    return () => clearTimeout(timer)
  }, [alert, onDismiss, reading])

  const team = ['xl', 'community'].includes(alert?.teamKey) ? alert.teamKey : null

  function start(event) {
    if (!event.isPrimary || event.button !== 0) return
    // Capture on the original control so a stationary release still clicks
    // that button, even on engines that do not implicitly capture a mouse.
    const target = event.target.closest('button') ?? event.currentTarget
    target.setPointerCapture(event.pointerId)
    press.current = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp }
    suppressClick.current = false
    y.stop()
  }

  function move(event) {
    const start = press.current
    if (start?.id !== event.pointerId) return
    const distance = event.clientY - start.y
    if (Math.hypot(event.clientX - start.x, distance) > 8) suppressClick.current = true
    if (suppressClick.current) y.set(Math.min(0, distance))
  }

  function release(event) {
    const start = press.current
    if (start?.id !== event.pointerId) return
    press.current = null
    const distance = start.y - event.clientY
    const elapsed = Math.max(1, event.timeStamp - start.time)
    if (event.type === 'pointerup' && (distance > 28 || (distance > 10 && distance / elapsed > .36))) {
      suppressClick.current = true
      onDismiss()
    } else {
      if (event.type !== 'pointerup') suppressClick.current = true
      if (reduce) y.jump(0)
      else animate(y, 0, SPRING_SNAPPY)
    }
  }

  return <div className="alert-position">
    <AnimatePresence>
      {alert && <motion.aside
        aria-label="Match notification" className="foreground-alert"
        initial={reduce ? false : { y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        exit={reduce ? { opacity: 0 } : { y: -50, opacity: 0 }}
        transition={reduce ? { duration: 0 } : SPRING_SNAPPY}
        style={{ y }} onPointerDown={start} onPointerMove={move} onPointerUp={release}
        onPointerCancel={release} onLostPointerCapture={release}
        onClickCapture={event => {
          // Browsers can synthesise a click after the swipe. Keyboard and
          // assistive activation have a click count of zero and stay available.
          if (event.detail && suppressClick.current) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}
        onFocus={() => setReading(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setReading(false) }}
        onHoverStart={() => setReading(true)} onHoverEnd={() => setReading(false)}
      >
        <img src={team ? '/push-' + team + '.png' : '/pwa-192x192.png'} width="34" height="34" alt="" />
        <button className="alert-open" onClick={() => onOpen(alert.url)}>
          <span role="status"><strong>{alert.title}</strong>{alert.body && <span>{alert.body}</span>}</span>
          <span className="alert-action">{actionText[alert.kind] ?? 'Open'} <span aria-hidden="true">→</span></span>
        </button>
        <button className="alert-dismiss" aria-label="Dismiss notification" onClick={onDismiss}>×</button>
      </motion.aside>}
    </AnimatePresence>
  </div>
}
