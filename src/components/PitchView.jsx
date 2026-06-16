import { useMemo } from 'react'
import { formationSlots } from '../lib/lineup'

export const initials = (name) => (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()

// First name on one line, surname on the next (shirt-style). Single-token names
// fall to the surname line.
function nameLines(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return { first: '', surname: parts[0] ?? '' }
  return { first: parts[0], surname: parts.slice(1).join(' ') }
}

// A formation pitch: lines from attack (top) to keeper (bottom), each slot a
// shirt with the player's headshot (initials fallback) and first name + surname.
// Read-only by default; pass onTapSlot to make the shirts tappable (the line-up
// editor). `badge` lets a caller annotate a slot (e.g. a goal tally).
export default function PitchView({ formation, starters, names, photos = {}, onTapSlot, activeSlot, badge }) {
  const lines = useMemo(() => {
    const slots = formationSlots(formation)
    const byLine = {}
    for (const s of slots) (byLine[s.line] ??= []).push(s)
    return Object.keys(byLine).map(Number).sort((a, b) => b - a).map((k) => byLine[k])
  }, [formation])

  return (
    <div className="pitch">
      {lines.map((line, i) => (
        <div className="pitch-line" key={i}>
          {line.map((s) => {
            const id = starters[s.slot]
            const on = activeSlot === s.slot
            const Tag = onTapSlot ? 'button' : 'div'
            const extra = id && badge ? badge(id) : null
            const { first, surname } = nameLines(names[id])
            return (
              <Tag key={s.slot} type={onTapSlot ? 'button' : undefined}
                className={'shirt' + (id ? ' filled' : '') + (on ? ' active' : '')}
                onClick={onTapSlot ? () => onTapSlot(s.slot) : undefined}>
                <span className="shirt-pos mono">{s.pos}</span>
                <span className="shirt-badge">
                  {id
                    ? (photos[id] ? <img className="shirt-photo" src={photos[id]} alt="" /> : initials(names[id]))
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
      <style>{`
        .pitch { background: linear-gradient(var(--green-dim-2), rgba(47,168,79,.10));
          border: 1px solid var(--green); border-radius: 14px; padding: 14px 8px;
          display: flex; flex-direction: column; gap: 10px; min-height: 320px; justify-content: space-between; }
        .pitch-line { display: flex; justify-content: space-around; gap: 6px; }
        .shirt { background: none; border: none; display: flex; flex-direction: column; align-items: center; gap: 3px;
          color: var(--bone); padding: 0; min-width: 60px; max-width: 72px; }
        .shirt-pos { font-size: 9px; color: var(--bone-dim); letter-spacing: .04em; }
        .shirt-badge { position: relative; width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center;
          overflow: hidden; background: var(--slate); border: 1.5px dashed var(--line-2); font-size: 13px; font-weight: 700; color: var(--bone-mute); }
        .shirt.filled .shirt-badge { background: var(--red-dim-2); border: 1.5px solid var(--red); color: var(--red-bright); border-style: solid; }
        .shirt.active .shirt-badge { box-shadow: 0 0 0 3px var(--red-dim); }
        .shirt-photo { width: 100%; height: 100%; object-fit: cover; }
        .shirt-tag { position: absolute; top: -6px; right: -6px; background: var(--gold); color: #1a1300;
          font-family: var(--font-mono); font-size: 9px; font-weight: 700; border-radius: 8px; padding: 1px 4px; line-height: 1.2; z-index: 1; }
        .shirt-name { display: flex; flex-direction: column; align-items: center; line-height: 1.1; max-width: 72px; }
        .shirt-first { font-size: 9px; color: var(--bone-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 72px; }
        .shirt-surname { font-size: 11px; font-weight: 600; color: var(--bone-mute); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 72px; }
      `}</style>
    </div>
  )
}
