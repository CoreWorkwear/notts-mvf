import { useId, useLayoutEffect, useRef } from 'react'
import { useSheetBack } from '../hooks/useSheetBack'

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
      <div
        ref={panel} tabIndex={-1} aria-label={label ?? 'Match details'}
        className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
      >
        <div className="grab-handle" />
        {children}
      </div>
    </div>
  )
}
