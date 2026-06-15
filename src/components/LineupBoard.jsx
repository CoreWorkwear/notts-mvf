import { useEffect, useMemo, useState } from 'react'
import { useLineup } from '../hooks/useLineup'
import { FORMATION_NAMES, formationSlots, stateToRows, filledCount } from '../lib/lineup'
import Toast from './Toast'

const initials = (name) => (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()

// Match-details line-up. Players see the picked XI + subs on a pitch; managers
// tap a slot to assign an available player (those who marked in / maybe), choose
// a formation, and name the subs. Saved to the lineups table (admin-write RLS).
export default function LineupBoard({ fixture, isAdmin, open }) {
  const { saved, pool, names, hasLineup, loading, save } = useLineup(fixture, open)
  const [formation, setFormation] = useState(saved.formation)
  const [starters, setStarters] = useState(saved.starters)
  const [subs, setSubs] = useState(saved.subs)
  const [active, setActive] = useState(null) // slot index, or 'sub', being assigned
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Sync local editor state whenever the saved line-up (re)loads.
  useEffect(() => {
    setFormation(saved.formation); setStarters(saved.starters); setSubs(saved.subs)
  }, [saved])

  const slots = useMemo(() => formationSlots(formation), [formation])
  const placed = useMemo(() => new Set([...Object.values(starters).filter(Boolean), ...subs]), [starters, subs])
  const remaining = pool.filter((p) => !placed.has(p.id))

  // Lines top (attack) → bottom (keeper) for the pitch.
  const lines = useMemo(() => {
    const byLine = {}
    for (const s of slots) (byLine[s.line] ??= []).push(s)
    return Object.keys(byLine).map(Number).sort((a, b) => b - a).map((k) => byLine[k])
  }, [slots])

  function assign(id) {
    if (active === 'sub') setSubs((s) => [...s, id])
    else setStarters((st) => ({ ...st, [active]: id }))
    setActive(null)
  }
  function clearSlot(slot) { setStarters((st) => { const n = { ...st }; delete n[slot]; return n }); setActive(null) }
  function removeSub(id) { setSubs((s) => s.filter((x) => x !== id)) }

  async function onSave() {
    setBusy(true); setError(null)
    const rows = stateToRows(fixture.id, { formation, starters, subs })
    const { error } = await save(rows)
    setBusy(false)
    if (error) setError(error.message)
    else setEditing(false)
  }

  if (loading) return <p className="muted center mt-4">Loading the line-up…</p>

  // ---- read-only (players, or admin not editing) ----
  if (!isAdmin || !editing) {
    return (
      <div className="mt-3">
        {!hasLineup ? (
          <div className="empty"><p className="empty-title">Line-up not picked yet</p>
            <p>{isAdmin ? 'Pick your XI from the players who are in.' : 'The manager names the side closer to kickoff.'}</p></div>
        ) : (
          <>
            <Pitch lines={lines} starters={starters} names={names} />
            {subs.length > 0 && (
              <div className="mt-3">
                <p className="kicker" style={{ color: 'var(--bone-mute)' }}>SUBS · {subs.length}</p>
                <div className="row gap-2 mt-2" style={{ flexWrap: 'wrap' }}>
                  {subs.map((id) => <span key={id} className="chip">{names[id] || '—'}</span>)}
                </div>
              </div>
            )}
          </>
        )}
        {isAdmin && (
          <button className="btn btn-primary btn-block mt-4" onClick={() => setEditing(true)}>
            {hasLineup ? 'Edit the line-up' : 'Pick the line-up'}
          </button>
        )}
      </div>
    )
  }

  // ---- editor (admin) ----
  return (
    <div className="mt-3">
      <Toast message={error} tone="error" onDismiss={() => setError(null)} />

      <p className="kicker"><span className="kicker-rule">FORMATION</span></p>
      <div className="row gap-2 mt-2" style={{ flexWrap: 'wrap' }}>
        {FORMATION_NAMES.map((f) => (
          <button key={f} type="button" className="chip" aria-pressed={formation === f} onClick={() => setFormation(f)}>{f}</button>
        ))}
      </div>

      <p className="dim mt-3" style={{ fontSize: 13 }}>{filledCount(starters)}/11 picked · tap a shirt to fill it</p>
      <Pitch lines={lines} starters={starters} names={names} onTapSlot={(slot) => setActive(slot)} activeSlot={active} />

      <div className="mt-4">
        <div className="row spread" style={{ alignItems: 'center' }}>
          <p className="kicker"><span className="kicker-rule">SUBS · {subs.length}</span></p>
          <button type="button" className="chip" onClick={() => setActive('sub')}>+ Add sub</button>
        </div>
        <div className="row gap-2 mt-2" style={{ flexWrap: 'wrap' }}>
          {subs.length === 0 ? <span className="dim" style={{ fontSize: 13 }}>No subs named.</span>
            : subs.map((id) => (
              <button key={id} type="button" className="chip" onClick={() => removeSub(id)}>{names[id] || '—'} ✕</button>
            ))}
        </div>
      </div>

      {/* Picker — the available pool (in/maybe) not already placed. */}
      {active != null && (
        <div className="picker mt-4">
          <div className="row spread" style={{ alignItems: 'center' }}>
            <p className="kicker"><span className="kicker-rule">{active === 'sub' ? 'PICK A SUB' : 'PICK A PLAYER'}</span></p>
            <button type="button" className="chip" onClick={() => setActive(null)}>Close</button>
          </div>
          {typeof active === 'number' && starters[active] && (
            <button type="button" className="btn btn-ghost btn-block mt-2" onClick={() => clearSlot(active)}
              style={{ color: 'var(--red-bright)' }}>Clear this slot</button>
          )}
          {remaining.length === 0 ? (
            <p className="dim mt-2" style={{ fontSize: 13 }}>Everyone available is already on the sheet. More players appear here when they mark themselves in.</p>
          ) : (
            <div className="col gap-2 mt-2">
              {remaining.map((p) => (
                <button key={p.id} type="button" className="card pick-row" onClick={() => assign(p.id)}>
                  <span className="pick-av mono">{initials(p.name)}</span>
                  <span className="grow" style={{ textAlign: 'left' }}>{p.name}</span>
                  <span className={'tag ' + (p.status === 'in' ? 'tag-in' : 'tag-maybe')}>{p.status === 'in' ? 'In' : 'Maybe'}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="row gap-2 mt-5">
        <button className="btn btn-ghost grow" disabled={busy} onClick={() => setEditing(false)}>Done</button>
        <button className="btn btn-primary grow" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : 'Save line-up'}</button>
      </div>

      <style>{`
        .picker { border: 1px solid var(--line-2); border-radius: 14px; padding: 14px; background: var(--coal); }
        .pick-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: var(--slate);
          color: var(--bone); border: 1px solid var(--line); }
        .pick-av { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; flex: none;
          background: var(--coal); border: 1px solid var(--line-2); font-size: 11px; font-weight: 600; }
        .tag-in { color: var(--green-bright); border-color: var(--green); }
        .tag-maybe { color: var(--amber); border-color: var(--amber); }
      `}</style>
    </div>
  )
}

// The pitch: lines from attack (top) to keeper (bottom); each slot a shirt.
function Pitch({ lines, starters, names, onTapSlot, activeSlot }) {
  return (
    <div className="pitch">
      {lines.map((line, i) => (
        <div className="pitch-line" key={i}>
          {line.map((s) => {
            const id = starters[s.slot]
            const on = activeSlot === s.slot
            const Tag = onTapSlot ? 'button' : 'div'
            return (
              <Tag key={s.slot} type={onTapSlot ? 'button' : undefined}
                className={'shirt' + (id ? ' filled' : '') + (on ? ' active' : '')}
                onClick={onTapSlot ? () => onTapSlot(s.slot) : undefined}>
                <span className="shirt-pos mono">{s.pos}</span>
                <span className="shirt-badge">{id ? initials(names[id]) : '+'}</span>
                <span className="shirt-name">{id ? (names[id]?.split(' ')[0] ?? '') : ''}</span>
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
        .shirt { background: none; border: none; display: flex; flex-direction: column; align-items: center; gap: 2px;
          color: var(--bone); padding: 0; min-width: 52px; }
        .shirt-pos { font-size: 9px; color: var(--bone-dim); letter-spacing: .04em; }
        .shirt-badge { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center;
          background: var(--slate); border: 1.5px dashed var(--line-2); font-size: 13px; font-weight: 700; color: var(--bone-mute); }
        .shirt.filled .shirt-badge { background: var(--red-dim-2); border: 1.5px solid var(--red); color: var(--red-bright); border-style: solid; }
        .shirt.active .shirt-badge { box-shadow: 0 0 0 3px var(--red-dim); }
        .shirt-name { font-size: 10px; color: var(--bone-mute); max-width: 56px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      `}</style>
    </div>
  )
}
