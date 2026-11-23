import { useId, useLayoutEffect, useRef } from 'react'
import { animate, motion, useMotionValue, useReducedMotion } from 'framer-motion'
import { useSheetBack } from '../hooks/useSheetBack'
import { SPRING_SHEET } from '../lib/motion'

const tabbable = 'a[href],button:not(:disabled),input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),[tabindex]'

export default function Sheet({ open, onClose, children, 'aria-label': label }) {
  useSheetBack(open, onClose)
  const panel = useRef(null)
  const trigger = useRef(null)
  const titleId = useId()
  const close = useRef(onClose)
  close.current = onClose

  useLayoutEffect(() => {
    if (open) return
    // Safari can leave body focused after a tap. Remember the control for the
    // duration of this click only, so a later deep link cannot steal its focus.
    let timer
    function remember(event) {
      trigger.current = event.target.closest?.(tabbable)
      clearTimeout(timer)
      timer = setTimeout(() => { trigger.current = null }, 0)
    }
    document.addEventListener('click', remember, true)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', remember, true)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    const dialog = panel.current
    const backdrop = dialog.parentElement
    const opener = trigger.current ?? document.activeElement
    trigger.current = null
    const heading = dialog.querySelector('h1,h2,h3') ?? dialog.querySelector('.display')
    if (!label && heading) {
      if (!heading.id) heading.id = titleId
      dialog.setAttribute('aria-labelledby', heading.id)
    }
    const focusTarget = dialog.querySelector('[data-sheet-focus]') ?? dialog
    focusTarget.focus({ preventScroll: true })

    function keydown(event) {
      const sheets = document.querySelectorAll('.sheet-backdrop > .sheet')
      if (sheets[sheets.length - 1] !== dialog) return
      if (event.key === 'Escape') {
        event.preventDefault()
        close.current()
        return
      }
      if (event.key !== 'Tab') return
      const controls = [...dialog.querySelectorAll(tabbable)].filter(el =>
        el.tabIndex >= 0 && !el.closest('[hidden],[inert]') && getComputedStyle(el).display !== 'none')
      const first = controls[0] ?? dialog
      const last = controls.at(-1) ?? dialog
      const active = document.activeElement
      if (event.shiftKey ? active === first || active === dialog || !dialog.contains(active)
        : active === last || !dialog.contains(active)) {
        event.preventDefault()
        const next = event.shiftKey ? last : first
        next.focus()
      }
    }
    document.addEventListener('keydown', keydown)

    // iOS scrolls the visual viewport when an input gets the software keyboard.
    // Following both events keeps the entire scrollport (including Save) visible.
    const viewport = window.visualViewport
    function fit() {
      if (viewport.scale === 1) {
        backdrop.style.setProperty('--viewport-top', viewport.offsetTop + 'px')
        backdrop.style.setProperty('--viewport-height', viewport.height + 'px')
      } else {
        // At pinch zoom the user pans the document freely.
        backdrop.style.removeProperty('--viewport-top')
        backdrop.style.removeProperty('--viewport-height')
      }
    }
    if (viewport) {
      fit()
      viewport.addEventListener('resize', fit)
      viewport.addEventListener('scroll', fit)
    }
    return () => {
      viewport?.removeEventListener('resize', fit)
      viewport?.removeEventListener('scroll', fit)
      document.removeEventListener('keydown', keydown)
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [open, label, titleId])
  if (!open) return null
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <SheetPanel panel={panel} label={label} onClose={() => close.current()}>{children}</SheetPanel>
    </div>
  )
}

// Limit the gesture to the grab handle so scrolling a form, selecting text
// and pulling a long team sheet to its start remain native browser gestures.
function SheetPanel({ panel, label, onClose, children }) {
  const reduce = useReducedMotion()
  const y = useMotionValue(0)
  const pointer = useRef(null)
  const dragged = useRef(false)
  const closing = useRef(false)
  useLayoutEffect(() => () => y.stop(), [y])

  function dismiss() {
    if (closing.current) return
    if (reduce) { y.jump(0); onClose(); return }
    closing.current = true
    const dialog = panel.current
    animate(y, window.innerHeight - dialog.getBoundingClientRect().top + y.get(), {
      ...SPRING_SHEET,
      onComplete() {
        onClose()
        // A form can stay open while it is saving. Give React a frame to
        // commit the dismissal, then return the grip if this panel is still here.
        requestAnimationFrame(() => {
          if (panel.current !== dialog) return
          closing.current = false
          animate(y, 0, SPRING_SHEET)
        })
      },
    })
  }
  function start(event) {
    if (!event.isPrimary || event.button !== 0 || closing.current) return
    pointer.current = { id: event.pointerId, top: event.clientY, time: event.timeStamp }
    dragged.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
    y.stop()
  }
  function move(event) {
    if (event.pointerId !== pointer.current?.id) return
    const distance = event.clientY - pointer.current.top
    if (Math.abs(distance) > 3) dragged.current = true
    if (dragged.current) y.set(Math.max(0, distance))
  }
  function release(event) {
    if (event.pointerId !== pointer.current?.id) return
    const distance = event.clientY - pointer.current.top
    const elapsed = Math.max(1, event.timeStamp - pointer.current.time)
    pointer.current = null
    if (event.type === 'pointerup' && (distance >= 80 || (distance > 24 && distance / elapsed > .65))) {
      dragged.current = true
      dismiss()
    } else if (reduce) {
      y.set(0)
    } else {
      animate(y, 0, SPRING_SHEET)
    }
  }

  return (
    <motion.div
      ref={panel} tabIndex={-1} aria-label={label ?? 'Match details'}
      className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
      initial={reduce ? false : { y: 32 }} animate={{ y: 0 }} transition={SPRING_SHEET} style={{ y }}
    >
      <button
        type="button" className="grab-handle" aria-label="Close sheet"
        onPointerDown={start} onPointerMove={move} onPointerUp={release}
        onPointerCancel={release} onLostPointerCapture={release}
        onClick={event => { if (!dragged.current || event.detail === 0) dismiss() }}
      />
      {children}
    </motion.div>
  )
}
