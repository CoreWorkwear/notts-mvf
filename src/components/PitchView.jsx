import ClubImage from './ClubImage'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, useMotionValue, useReducedMotion } from 'framer-motion'
import { formationSlots } from '../lib/lineup'
import { SPRING_SNAPPY } from '../lib/motion'
import { haptic } from '../lib/haptics'

export const initials = (name) => (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()

// First name on one line, surname on the next (shirt-style). Single-token names
// fall to the surname line.
function nameLines(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return { first: '', surname: parts[0] ?? '' }
  return { first: parts[0], surname: parts.slice(1).join(' ') }
}

const DRAG_THRESHOLD = 8 // px before a press becomes a drag (vs a tap)
const TOUCH_HOLD_MS = 240

// A formation pitch: lines from attack (top) to keeper (bottom), each slot a
// shirt with the player's headshot (initials fallback) and first name + surname.
// Read-only by default. In the editor (onTapSlot set) a TAP opens the picker and,
// when onSwap is given, DRAGGING a shirt onto another swaps the two players
// (or moves into an empty slot). Pointer-events based, so it works on touch.
export default function PitchView({ teamKey, formation, slots, starters, names, photos = {}, onTapSlot, onSwap, activeSlot, badge }) {
  const lines = useMemo(() => {
    const ss = slots || formationSlots(formation)
    const byLine = {}
    for (const s of ss) (byLine[s.line] ??= []).push(s)
    return Object.keys(byLine).map(Number).sort((a, b) => b - a).map((k) => byLine[k])
  }, [formation, slots])

  const editor = !!onTapSlot
  const reduced = useReducedMotion()
  const canSwap = !!onSwap
  const animated = canSwap && !reduced
  const pitch = useRef(null)
  const press = useRef(null) // { slot, x0, y0, filled, moved }
  const skipClick = useRef(false)
  const [drag, setDrag] = useState(null)
  const x = useMotionValue(0)
  const y = useMotionValue(0)

  // Scrolling always wins a quick swipe. Only a deliberate hold on a filled
  // shirt claims touchmove, before the browser hands the gesture to the sheet.
  useEffect(() => {
    if (!canSwap) return
    const node = pitch.current
    function touchMove(event) {
      const p = press.current
      if (event.touches.length === 1 && p?.filled && !p.scrolling &&
          event.timeStamp - p.started >= TOUCH_HOLD_MS && event.cancelable) event.preventDefault()
    }
    node.addEventListener('touchmove', touchMove, { passive: false })
    return () => node.removeEventListener('touchmove', touchMove)
  }, [canSwap])

  function shirtAt(x, y) {
    const el = document.elementFromPoint(x, y)?.closest('[data-slot]')
    return el && pitch.current.contains(el) ? el : null
  }

  function onPointerDown(e, slot) {
    if (!editor || e.button > 0) return
    if (e.isPrimary === false || (press.current && press.current.id !== e.pointerId)) {
      press.current = null
      skipClick.current = true
      setDrag(null)
      return
    }
    skipClick.current = false
    press.current = { slot, id: e.pointerId, x0: e.clientX, y0: e.clientY, started: e.timeStamp,
      touch: e.pointerType === 'touch', filled: starters[slot] != null, moved: false, scrolling: false }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not supported */ }
  }
  function onPointerMove(e) {
    const p = press.current
    if (!p || p.id !== e.pointerId || p.scrolling) return
    if (!p.moved && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < DRAG_THRESHOLD) return
    p.moved = true
    if (p.touch && e.timeStamp - p.started < TOUCH_HOLD_MS) {
      p.scrolling = true
      return
    }
    if (p.filled && onSwap) {
      x.set(e.clientX)
      y.set(e.clientY)
      const shirt = shirtAt(e.clientX, e.clientY)
      const over = shirt ? Number(shirt.dataset.slot) : null
      setDrag(current => current?.from === p.slot && current.over === over ? current : { from: p.slot, over })
    }
  }
  function onPointerUp(e) {
    const p = press.current
    if (!p || p.id !== e.pointerId) return
    press.current = null
    setDrag(null)
    skipClick.current = p.moved || Math.hypot(e.clientX - p.x0, e.clientY - p.y0) >= DRAG_THRESHOLD
    if (p.filled && p.moved && !p.scrolling && onSwap) {
      const shirt = shirtAt(e.clientX, e.clientY)
      if (shirt && Number(shirt.dataset.slot) !== p.slot) {
        haptic('tap', shirt)
        onSwap(p.slot, Number(shirt.dataset.slot))
      }
    }
  }
  // A cancelled gesture (e.g. the OS taking over) must clear state cleanly.
  function onPointerCancel(event) {
    if (!press.current || press.current.id !== event.pointerId) return
    press.current = null
    skipClick.current = true
    setDrag(null)
  }

  const dragName = drag ? names[starters[drag.from]] : ''

  return (
    <div ref={pitch} data-team={teamKey} className={'pitch' + (editor ? ' editing' : '') + (drag ? ' dragging' : '')}>
      {lines.map((line, i) => (
        <div className="pitch-line" key={i}>
          {line.map((s) => {
            const id = starters[s.slot]
            const on = activeSlot === s.slot
            const Tag = editor ? 'button' : 'div'
            const Badge = animated && id ? motion.span : 'span'
            const extra = id && badge ? badge(id) : null
            const { first, surname } = nameLines(names[id])
            return (
              <Tag key={s.slot} type={editor ? 'button' : undefined} data-slot={s.slot}
                className={'shirt' + (id ? ' filled' : '') + (on ? ' active' : '')
                  + (drag?.from === s.slot ? ' lifting' : '') + (drag && drag.over === s.slot && drag.from !== s.slot ? ' drop-target' : '')}
                onPointerDown={editor ? (e) => onPointerDown(e, s.slot) : undefined}
                onPointerMove={editor ? onPointerMove : undefined}
                onPointerUp={editor ? onPointerUp : undefined}
                onClick={editor ? e => {
                  // Opening scrolls the picker into view. Wait for the native
                  // click so touchend cannot retarget it to the first player.
                  if (!skipClick.current || e.detail === 0) onTapSlot(s.slot, e.currentTarget)
                } : undefined}
                aria-label={editor ? `${s.pos}, ${id ? names[id] || 'Selected player' : 'pick a player'}` : undefined}
                onLostPointerCapture={editor ? onPointerCancel : undefined}
                onPointerCancel={editor ? onPointerCancel : undefined}>
                <span className="shirt-pos mono">{s.pos}</span>
                <Badge key={id ?? 'vacant'} className="shirt-badge"
                  {...(animated && id ? { layoutId: 'player-' + id, initial: { scale: .88 },
                    animate: { scale: 1 }, transition: SPRING_SNAPPY } : {})}>
                  {id
                    ? (photos[id] ? <ClubImage sizes="40px" className="shirt-photo" src={photos[id]} alt="" draggable={false} /> : initials(names[id]))
                    : '+'}
                  {extra ? <span className="shirt-tag">{extra}</span> : null}
                </Badge>
                <span className="shirt-name">
                  {id && first && <span className="shirt-first">{first}</span>}
                  {id && <span className="shirt-surname">{surname}</span>}
                </span>
              </Tag>
            )
          })}
        </div>
      ))}

      {/* The shirt being dragged, following the finger. */}
      {drag && createPortal(
        <motion.div className="drag-ghost" aria-hidden="true" style={{ x, y }}>
          {photos[starters[drag.from]]
            ? <ClubImage sizes="40px" src={photos[starters[drag.from]]} alt="" />
            : <span className="mono">{initials(dragName)}</span>}
        </motion.div>, document.body
      )}

      <style>{`
        .pitch { position: relative; --shirt-colour: var(--team-xl); background: var(--surface-raised);
          border: 1px solid var(--green); border-radius: var(--r-card); padding: var(--space-3) var(--space-2);
          display: flex; flex-direction: column; gap: var(--space-2); min-height: 320px; justify-content: space-between; }
        .pitch[data-team="community"] { --shirt-colour: var(--team-community); }
        .pitch-line { display: flex; justify-content: space-around; gap: var(--space-1); }
        .shirt { background: none; border: none; display: flex; flex-direction: column; align-items: center; gap: var(--space-1);
          color: var(--bone); padding: 0; min-width: 60px; max-width: 72px; }
        .pitch.editing .shirt { touch-action: pan-y pinch-zoom; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
        .shirt-pos { font-size: var(--type-xs); color: var(--bone-dim); letter-spacing: .04em; }
        .shirt-badge { position: relative; width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center;
          overflow: hidden; background: var(--slate); border: 1.5px dashed var(--line-2); font-size: var(--type-sm); font-weight: 700; color: var(--bone-mute);
          transition: box-shadow var(--t-fast), transform var(--t-fast); }
        .shirt.filled .shirt-badge { background: var(--surface); border: 1.5px solid var(--shirt-colour); color: var(--shirt-colour); border-style: solid; }
        .shirt.active .shirt-badge { outline: 2px solid var(--shirt-colour); outline-offset: 2px; }
        .shirt.lifting .shirt-badge { opacity: .35; }
        .shirt.drop-target .shirt-badge { box-shadow: 0 0 0 3px var(--gold); transform: scale(1.08); }
        .shirt-photo { width: 100%; height: 100%; object-fit: cover; }
        .shirt-tag { position: absolute; top: -6px; right: -6px; background: var(--award-fill); color: var(--award-ink);
          font-family: var(--font-mono); font-size: var(--type-xs); font-weight: 700; border-radius: var(--r-input); padding: var(--space-1) var(--space-1); line-height: 1.2; z-index: 1; }
        .shirt-name { display: flex; flex-direction: column; align-items: center; line-height: 1.1; max-width: 72px; }
        .shirt-first { font-size: var(--type-xs); color: var(--bone-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 72px; }
        .shirt-surname { font-size: var(--type-xs); font-weight: 600; color: var(--bone-mute); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 72px; }
        .drag-ghost { position: fixed; inset: 0 auto auto 0; width: 48px; height: 48px; border-radius: 50%; translate: -50% -50%;
          overflow: hidden; pointer-events: none; z-index: 110; background: var(--surface-raised); border: 2px solid var(--text-muted);
          display: grid; place-items: center; color: var(--red-bright); font-weight: 700; box-shadow: var(--shadow-float); }
        .drag-ghost img { width: 100%; height: 100%; object-fit: cover; }
      `}</style>
    </div>
  )
}
