import { useEffect, useMemo, useState } from 'react'
import { useLineup } from '../hooks/useLineup'
import { FORMATION_NAMES, stateToRows, filledCount, swapStarters } from '../lib/lineup'
import { fixtureMatchup } from '../lib/teams'
import { supabase } from '../lib/supabase'
import PitchView, { initials } from './PitchView'
import Toast from './Toast'

// Match-details line-up. Players see the picked XI + subs on a pitch; managers
// tap a slot to assign an available player (those who marked in / maybe), choose
// a formation, and name the subs. Saved to the lineups table (admin-write RLS).
export default function LineupBoard({ fixture, isAdmin, open }) {
  const { saved, pool, names, photos = {}, hasLineup, loading, save } = useLineup(fixture, open)
  const [formation, setFormation] = useState(saved.formation)
  const [starters, setStarters] = useState(saved.starters)
  const [subs, setSubs] = useState(saved.subs)
  const [active, setActive] = useState(null) // slot index, or 'sub', being assigned
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [pushing, setPushing] = useState(false)
  const [pushMsg, setPushMsg] = useState(null)

  // Push the named line-up to the picked players (starters + subs). Uses the
  // admin-gated send-push function; fails gracefully if it's unavailable.
  async function notifySquad() {
    const ids = [...Object.values(saved.starters).filter(Boolean), ...saved.subs]
    if (!ids.length) return
    setPushing(true); setPushMsg(null)
    try {
      const { data, error } = await supabase.functions.invoke('send-push', {
        body: {
          profileIds: ids,
          title: fixtureMatchup(fixture),
          body: "Team news — you're named in the squad 👕. Tap for the line-up.",
          url: '/fixtures',
        },
      })
      if (error) throw error
      setPushMsg(`Sent to ${data?.sent ?? 0}`)
    } catch {
      setPushMsg('Push unavailable')
    } finally {
      setPushing(false)
      setTimeout(() => setPushMsg(null), 2800)
    }
  }

  // Sync local editor state whenever the saved line-up (re)loads.
  useEffect(() => {
    setFormation(saved.formation); setStarters(saved.starters); setSubs(saved.subs)
  }, [saved])

  const placed = useMemo(() => new Set([...Object.values(starters).filter(Boolean), ...subs]), [starters, subs])
  const remaining = pool.filter((p) => !placed.has(p.id))

  function assign(id) {
    if (active === 'sub') setSubs((s) => [...s, id])
    else setStarters((st) => ({ ...st, [active]: id }))
    setActive(null)
  }
  function clearSlot(slot) { setStarters((st) => { const n = { ...st }; delete n[slot]; return n }); setActive(null) }
  function removeSub(id) { setSubs((s) => s.filter((x) => x !== id)) }

  // Drag-and-drop: swap two filled slots, or move a player into an empty one.
  function swapSlots(from, to) {
    setActive(null)
    setStarters((st) => swapStarters(st, from, to))
  }

  async function onSave() {
    setBusy(true); setError(null)
    const rows = stateToRows(fixture.id, { formation, starters, subs }, names)
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
            <PitchView formation={formation} starters={starters} names={names} photos={photos} />
            {subs.length > 0 && (
              <div className="mt-3">
                <p className="kicker" style={{ color: 'var(--bone-mute)' }}>SUBS · {subs.length}</p>
                <div className="col gap-2 mt-2">
                  {subs.map((id) => (
                    <div key={id} className="sub-line">
                      {photos[id] ? <img className="sub-av" src={photos[id]} alt="" /> : <span className="sub-av mono">{initials(names[id])}</span>}
                      <span>{names[id] || '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        {isAdmin && (
          hasLineup ? (
            <div className="col gap-2 mt-4">
              <button className="btn btn-primary btn-block" disabled={pushing} onClick={notifySquad}>
                {pushing ? 'Sending…' : pushMsg || 'Push the line-up to the squad'}
              </button>
              <button className="btn btn-ghost btn-block" onClick={() => setEditing(true)}>Edit the line-up</button>
            </div>
          ) : (
            <button className="btn btn-primary btn-block mt-4" onClick={() => setEditing(true)}>Pick the line-up</button>
          )
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

      <p className="dim mt-3" style={{ fontSize: 13 }}>{filledCount(starters)}/11 picked · tap a shirt to fill it, drag one onto another to swap</p>
      <PitchView formation={formation} starters={starters} names={names} photos={photos} onTapSlot={(slot) => setActive(slot)} onSwap={swapSlots} activeSlot={active} />

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
                  {p.photo_url ? <img className="pick-av" src={p.photo_url} alt="" /> : <span className="pick-av mono">{initials(p.name)}</span>}
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
          background: var(--coal); border: 1px solid var(--line-2); font-size: 11px; font-weight: 600;
          overflow: hidden; object-fit: cover; }
        img.pick-av { object-fit: cover; }
        .sub-line { display: flex; align-items: center; gap: 10px; font-size: 14px; }
        .sub-av { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; flex: none;
          background: var(--slate); border: 1px solid var(--line-2); font-size: 11px; font-weight: 600; overflow: hidden; object-fit: cover; }
        .tag-in { color: var(--green-bright); border-color: var(--green); }
        .tag-maybe { color: var(--amber); border-color: var(--amber); }
      `}</style>
    </div>
  )
}
