import { useMemo, useRef, useState } from 'react'
import { formationSlots } from '../lib/lineup'

export const initials = (name) => (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()

// First name on one line, surname on the next (shirt-style). Single-token names
// fall to the surname line.
function nameLines(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return { first: '', surname: parts[0] ?? '' }
  return { first: parts[0], surname: parts.slice(1).join(' ') }
}

const DRAG_THRESHOLD = 8 // px before a press becomes a drag (vs a tap)

// A formation pitch: lines from attack (top) to keeper (bottom), each slot a
// shirt with the player's headshot (initials fallback) and first name + surname.
// Read-only by default. In the editor (onTapSlot set) a TAP opens the picker and,
// when onSwap is given, DRAGGING a shirt onto another swaps the two players
// (or moves into an empty slot). Pointer-events based, so it works on touch.
export default function PitchView({ formation, starters, names, photos = {}, onTapSlot, onSwap, activeSlot, badge }) {
  const lines = useMemo(() => {
    const slots = formationSlots(formation)
    const byLine = {}
    for (const s of slots) (byLine[s.line] ??= []).push(s)
    return Object.keys(byLine).map(Number).sort((a, b) => b - a).map((k) => byLine[k])
  }, [formation])

  const editor = !!onTapSlot
  const press = useRef(null) // { slot, x0, y0, filled, moved }
  const [drag, setDrag] = useState(null) // { from, x, y, over } while dragging

  function slotAt(x, y) {
    const el = document.elementFromPoint(x, y)?.closest('[data-slot]')
    return el ? Number(el.getAttribute('data-slot')) : null
  }

  function onPointerDown(e, slot) {
    if (!editor) return
    press.current = { slot, x0: e.clientX, y0: e.clientY, filled: starters[slot] != null, moved: false }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not supported */ }
  }
  function onPointerMove(e) {
    const p = press.current
    if (!p) return
    if (!p.moved && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < DRAG_THRESHOLD) return
    p.moved = true
    if (p.filled && onSwap) setDrag({ from: p.slot, x: e.clientX, y: e.clientY, over: slotAt(e.clientX, e.clientY) })
  }
  function onPointerUp(e) {
    const p = press.current
    press.current = null
    setDrag(null)
    if (!p) return
    if (p.filled && p.moved && onSwap) {
      const target = slotAt(e.clientX, e.clientY)
      if (target != null && target !== p.slot) onSwap(p.slot, target)
    } else if (!p.moved) {
      onTapSlot(p.slot)
    }
  }

  const dragName = drag ? names[starters[drag.from]] : ''

  return (
    <div className={'pitch' + (drag ? ' dragging' : '')}>
      {lines.map((line, i) => (
        <div className="pitch-line" key={i}>
          {line.map((s) => {
            const id = starters[s.slot]
            const on = activeSlot === s.slot
            const Tag = editor ? 'button' : 'div'
            const extra = id && badge ? badge(id) : null
            const { first, surname } = nameLines(names[id])
            return (
              <Tag key={s.slot} type={editor ? 'button' : undefined} data-slot={s.slot}
                className={'shirt' + (id ? ' filled' : '') + (on ? ' active' : '')
                  + (drag?.from === s.slot ? ' lifting' : '') + (drag && drag.over === s.slot && drag.from !== s.slot ? ' drop-target' : '')}
                onPointerDown={editor ? (e) => onPointerDown(e, s.slot) : undefined}
                onPointerMove={editor ? onPointerMove : undefined}
                onPointerUp={editor ? onPointerUp : undefined}>
                <span className="shirt-pos mono">{s.pos}</span>
                <span className="shirt-badge">
                  {id
                    ? (photos[id] ? <img className="shirt-photo" src={photos[id]} alt="" draggable={false} /> : initials(names[id]))
                    : '+'}
                  {extra ? <span className="shirt-tag">{extra}</span> : null}
                </span>
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
      {drag && (
        <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>
          {photos[starters[drag.from]]
            ? <img src={photos[starters[drag.from]]} alt="" />
            : <span className="mono">{initials(dragName)}</span>}
        </div>
      )}

      <style>{`
        .pitch { position: relative; background: linear-gradient(var(--green-dim-2), rgba(47,168,79,.10));
          border: 1px solid var(--green); border-radius: 14px; padding: 14px 8px;
          display: flex; flex-direction: column; gap: 10px; min-height: 320px; justify-content: space-between; }
        .pitch-line { display: flex; justify-content: space-around; gap: 6px; }
        .shirt { background: none; border: none; display: flex; flex-direction: column; align-items: center; gap: 3px;
          color: var(--bone); padding: 0; min-width: 60px; max-width: 72px; }
        .pitch.dragging .shirt { touch-action: none; }
        .shirt-pos { font-size: 9px; color: var(--bone-dim); letter-spacing: .04em; }
        .shirt-badge { position: relative; width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center;
          overflow: hidden; background: var(--slate); border: 1.5px dashed var(--line-2); font-size: 13px; font-weight: 700; color: var(--bone-mute);
          transition: box-shadow var(--t-fast), transform var(--t-fast); }
        .shirt.filled .shirt-badge { background: var(--red-dim-2); border: 1.5px solid var(--red); color: var(--red-bright); border-style: solid; }
        .shirt.active .shirt-badge { box-shadow: 0 0 0 3px var(--red-dim); }
        .shirt.lifting .shirt-badge { opacity: .35; }
        .shirt.drop-target .shirt-badge { box-shadow: 0 0 0 3px var(--gold); transform: scale(1.08); }
        .shirt-photo { width: 100%; height: 100%; object-fit: cover; }
        .shirt-tag { position: absolute; top: -6px; right: -6px; background: var(--gold); color: #1a1300;
          font-family: var(--font-mono); font-size: 9px; font-weight: 700; border-radius: 8px; padding: 1px 4px; line-height: 1.2; z-index: 1; }
        .shirt-name { display: flex; flex-direction: column; align-items: center; line-height: 1.1; max-width: 72px; }
        .shirt-first { font-size: 9px; color: var(--bone-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 72px; }
        .shirt-surname { font-size: 11px; font-weight: 600; color: var(--bone-mute); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 72px; }
        .drag-ghost { position: fixed; width: 48px; height: 48px; border-radius: 50%; transform: translate(-50%, -50%);
          overflow: hidden; pointer-events: none; z-index: 50; background: var(--red-dim-2); border: 2px solid var(--red);
          display: grid; place-items: center; color: var(--red-bright); font-weight: 700; box-shadow: 0 8px 20px -6px rgba(0,0,0,.8); }
        .drag-ghost img { width: 100%; height: 100%; object-fit: cover; }
      `}</style>
    </div>
  )
}
