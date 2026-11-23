import ClubImage from './ClubImage'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import { useLineup } from '../hooks/useLineup'
import { FORMATION_NAMES, stateToRows, filledCount, swapStarters } from '../lib/lineup'
import { fixtureMatchup } from '../lib/teams'
import { supabase } from '../lib/supabase'
import PitchView, { initials } from './PitchView'
import Toast from './Toast'
import { haptic } from '../lib/haptics'
import { friendlyError } from '../lib/errors'
import { SPRING_SNAPPY, tap } from '../lib/motion'

// Match-details line-up. Players see the picked XI + subs on a pitch; managers
// tap a slot to assign a player, choose a formation, and name the subs. The pool
// is those who marked in / maybe, widening to the whole squad from kickoff
// (useLineup). Saved to the lineups table (admin-write RLS).

// What a player answered, as the picker shows it. "none" and "out" only reach
// the pool from kickoff, when the whole squad is offered.
const ANSWER_TAG = {
  in: { label: 'In', cls: 'tag-in' },
  maybe: { label: 'Maybe', cls: 'tag-maybe' },
  none: { label: 'No answer', cls: '' },
  out: { label: 'Said out', cls: 'tag-out' },
}

export default function LineupBoard({ fixture, isAdmin, open }) {
  const { saved, pool, wholeSquad = false, names, photos = {}, hasLineup, loading, error: loadError, refetch, save } = useLineup(fixture, open)
  const [formation, setFormation] = useState(saved.formation)
  const [starters, setStarters] = useState(saved.starters)
  const [subs, setSubs] = useState(saved.subs)
  const [active, setActive] = useState(null) // slot index, or 'sub', being assigned
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [pushing, setPushing] = useState(false)
  const [pushMsg, setPushMsg] = useState(null)
  const [justSaved, setJustSaved] = useState(false)
  const picker = useRef(null)
  const pickerPress = useRef(null)
  const slotButton = useRef(null)
  const readinessMeter = useRef(null)
  const benchButton = useRef(null)
  const pitchGroup = useId()
  const reduced = useReducedMotion()

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
          fixtureId: fixture.id,
          teamKey: fixture.team?.key,
          kind: 'lineup',
          title: fixtureMatchup(fixture),
          body: "You're in the squad. View line-up.",
          url: `/fixtures?mvf_fixture=${encodeURIComponent(fixture.id)}&view=lineup`,
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

  // A reload after a failed save may return the previous XI. Keep the draft
  // available for retry until the manager saves it or leaves the editor.
  useEffect(() => {
    if (editing) return
    setFormation(saved.formation); setStarters(saved.starters); setSubs(saved.subs)
  }, [saved, editing])

  const placed = useMemo(() => new Set([...Object.values(starters).filter(Boolean), ...subs]), [starters, subs])
  const remaining = pool.filter((p) => !placed.has(p.id) || (typeof active === 'number' && subs.includes(p.id)))
  const picked = filledCount(starters)
  const confirmed = pool.filter(p => placed.has(p.id) && p.status === 'in').length
  const maybe = pool.filter(p => placed.has(p.id) && p.status === 'maybe').length
  const unconfirmed = placed.size - confirmed - maybe

  useEffect(() => {
    if (active == null) return
    picker.current?.focus({ preventScroll: true })
    picker.current?.scrollIntoView?.({ block: 'start', behavior: 'instant' })
  }, [active])

  function openPicker(slot, button) {
    slotButton.current = button
    pickerPress.current = null
    setActive(slot)
  }
  function trackPickerPointer(event) {
    const press = pickerPress.current
    if (event.type === 'pointerdown') {
      pickerPress.current = { x: event.clientX, y: event.clientY, moved: event.isPrimary === false }
    } else if (press && (event.type === 'pointercancel' ||
        Math.hypot(event.clientX - press.x, event.clientY - press.y) >= 8)) {
      press.moved = true
    }
  }
  function closePicker() {
    setActive(null)
    slotButton.current?.focus({ preventScroll: true })
    slotButton.current?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' })
  }
  function assign(id) {
    haptic('tap', slotButton.current)
    if (active === 'sub') setSubs((s) => [...s, id])
    else {
      // Promoting a sub onto an occupied shirt exchanges their places.
      if (subs.includes(id)) setSubs(s => s.map(sub => sub === id ? starters[active] : sub).filter(Boolean))
      setStarters((st) => ({ ...st, [active]: id }))
    }
    closePicker()
  }
  function clearSlot(slot, toBench = false) {
    haptic('tap', slotButton.current)
    if (toBench) setSubs(s => [...s, starters[slot]])
    setStarters((current) => {
      const next = { ...current }
      delete next[slot]
      return next
    })
    closePicker()
  }
  function removeSub(id) {
    haptic('tap', benchButton.current)
    setSubs((s) => s.filter((x) => x !== id))
  }

  // Drag-and-drop: swap two filled slots, or move a player into an empty one.
  function swapSlots(from, to) {
    setActive(null)
    setStarters((st) => swapStarters(st, from, to))
  }

  async function onSave() {
    if (!navigator.onLine) {
      setError("You're offline. Reconnect to save the line-up.")
      return
    }
    setBusy(true); setError(null); setActive(null)
    const rows = stateToRows(fixture.id, { formation, starters, subs }, names)
    try {
      const { error } = await save(rows)
      if (error) throw error
      haptic('success', readinessMeter.current)
      setJustSaved(true)
      setEditing(false)
    } catch (err) {
      haptic('warn', readinessMeter.current)
      setError(friendlyError(err, "Couldn't save the line-up. Try again."))
    } finally {
      setBusy(false)
    }
  }

  // "Done" is not "Save": leave the editor showing the SAVED line-up (the one
  // the push button sends), not the unsaved picks.
  function onDone() {
    setFormation(saved.formation); setStarters(saved.starters); setSubs(saved.subs)
    setActive(null); setEditing(false)
  }

  // First load only: once a line-up is on screen a reload (after a save) must
  // not blank the board.
  if (loading && !hasLineup && !editing) return <p className="muted center mt-4">Loading the line-up…</p>

  // A failed load leaves the hook with an EMPTY line-up, which is exactly what
  // "not picked yet" looks like. Say it failed instead: the squad was being told
  // no side had been named, and Pick → Save from the empty editor deleted the
  // real one (save() replaces the whole set, so an empty set is a delete).
  // Not while the editor is open, though: the editor can only be reached after
  // a load that worked, so an error here means the reload AFTER a save failed —
  // and then the picks on screen may be the only copy. Save is the way out.
  if (loadError && !hasLineup && !editing) {
    return (
      <div className="mt-4">
        <p className="field-error" role="alert">Couldn't load the line-up. Check your connection.</p>
        <button className="btn btn-ghost btn-block mt-3" onClick={() => refetch()}>Try again</button>
      </div>
    )
  }

  const readiness = (
    <div className="lineup-readiness">
      <div className="row spread gap-2">
        <strong><span className="mono">{picked}/11</span> starters picked</strong>
        <span>{confirmed} confirmed · {maybe} maybe{unconfirmed > 0 && ` · ${unconfirmed} unconfirmed`}</span>
      </div>
      <div ref={readinessMeter} role="meter" aria-label="Starting XI picked" aria-valuemin={0} aria-valuemax={11}
        aria-valuenow={picked} aria-valuetext={`${picked} of 11 starters picked`} className="lineup-meter">
        <span style={{ transform: `scaleX(${picked / 11})` }} />
      </div>
    </div>
  )

  // ---- read-only (players, or admin not editing) ----
  if (!isAdmin || !editing || busy) {
    const showPitch = busy ? placed.size > 0 : hasLineup
    return (
      <div className="mt-3">
        <Toast message={justSaved ? 'Line-up saved.' : null} tone="success" onDismiss={() => setJustSaved(false)} />
        {busy && <p role="status" className="save-progress">Saving line-up…</p>}
        {!showPitch ? (
          <div className="empty"><p className="empty-title">Line-up not picked yet</p></div>
        ) : (
          <>
            {isAdmin && readiness}
            <PitchView teamKey={fixture.team?.key} formation={formation} starters={starters} names={names} photos={photos} />
            {subs.length > 0 && (
              <div className="mt-3">
                <p className="kicker" style={{ color: 'var(--bone-mute)' }}>SUBS · {subs.length}</p>
                <div className="col gap-2 mt-2">
                  {subs.map((id) => (
                    <div key={id} className="sub-line">
                      {photos[id] ? <ClubImage sizes="40px" className="sub-av" src={photos[id]} alt="" /> : <span className="sub-av mono">{initials(names[id])}</span>}
                      <span>{names[id] || '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        {/* A reload that failed (after a save) leaves the board showing what was
            loaded before. Say so, and don't push a line-up we can't vouch for. */}
        {!busy && loadError && hasLineup && (
          <div className="row spread gap-2 mt-3" style={{ alignItems: 'center' }}>
            <p className="field-error" role="alert">Couldn't refresh the line-up. Showing saved line-up.</p>
            <button type="button" className="chip" onClick={() => refetch()}>Try again</button>
          </div>
        )}
        {isAdmin && !busy && (
          hasLineup ? (
            <div className="col gap-2 mt-4">
              <button className="btn btn-primary btn-block" disabled={pushing || !!loadError} onClick={notifySquad}>
                {pushing ? 'Sending…' : pushMsg || 'Send line-up to squad'}
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
    <LayoutGroup id={pitchGroup}>
      <Toast message={error} tone="error" onDismiss={() => setError(null)} />

      <p className="kicker mt-3"><span className="kicker-rule">FORMATION</span></p>
      <div className="row gap-2 mt-2" style={{ flexWrap: 'wrap' }}>
        {FORMATION_NAMES.map((f) => (
          <button key={f} type="button" className="chip mono" aria-pressed={formation === f} onClick={() => setFormation(f)}>{f}</button>
        ))}
      </div>

      {readiness}
      <p className="lineup-hint">Tap a shirt to pick. Hold and drag to swap.</p>
      <PitchView teamKey={fixture.team?.key} formation={formation} starters={starters} names={names} photos={photos} onTapSlot={openPicker} onSwap={swapSlots} activeSlot={active} />

      <div className="mt-4">
        <div className="row spread" style={{ alignItems: 'center' }}>
          <p className="kicker"><span className="kicker-rule">SUBS · {subs.length}</span></p>
          <button ref={benchButton} type="button" className="chip" onClick={e => openPicker('sub', e.currentTarget)}>+ Add sub</button>
        </div>
        <div className="row gap-2 mt-2" style={{ flexWrap: 'wrap' }}>
          {subs.length === 0 ? <span className="dim" style={{ fontSize: 'var(--type-sm)' }}>No subs named.</span>
            : subs.map((id) => (
              <motion.button key={id} type="button" className="chip bench-player" aria-label={`Remove ${names[id]} from the bench`}
                layout={reduced ? false : 'position'} whileTap={reduced ? undefined : tap}
                transition={SPRING_SNAPPY} onClick={() => removeSub(id)}>
                <motion.span className="sub-av" layoutId={reduced ? undefined : 'player-' + id}
                  initial={reduced ? false : { scale: .88 }} animate={{ scale: 1 }} transition={SPRING_SNAPPY}>
                  {photos[id] ? <ClubImage sizes="30px" src={photos[id]} alt="" /> : initials(names[id])}
                </motion.span>
                {names[id] || '—'} <span aria-hidden="true">×</span>
              </motion.button>
            ))}
        </div>
      </div>

      {/* Picker — the pool not already placed: in/maybe, or the whole squad from kickoff. */}
      {active != null && (
        <div className="picker mt-4" ref={picker} tabIndex={-1} role="group" aria-label={active === 'sub' ? 'Pick a sub' : 'Pick a player'}
          onPointerDownCapture={trackPickerPointer} onPointerMoveCapture={trackPickerPointer} onPointerUpCapture={trackPickerPointer}
          onPointerCancelCapture={trackPickerPointer} onClickCapture={event => {
            if (event.detail > 0 && pickerPress.current?.moved) event.stopPropagation()
            pickerPress.current = null
          }}>
          <div className="row spread" style={{ alignItems: 'center' }}>
            <p className="kicker"><span className="kicker-rule">{active === 'sub' ? 'PICK A SUB' : 'PICK A PLAYER'}</span></p>
            <button type="button" className="chip" onClick={closePicker}>Close</button>
          </div>
          {typeof active === 'number' && starters[active] && (
            <div className="row gap-2 mt-2 lineup-slot-actions">
              <button type="button" className="btn btn-ghost grow" onClick={() => clearSlot(active, true)}>Move to bench</button>
              <button type="button" className="btn btn-ghost grow" onClick={() => clearSlot(active)}>Clear this slot</button>
            </div>
          )}
          {wholeSquad && <p className="dim mt-2" style={{ fontSize: 'var(--type-sm)' }}>Whole squad · After kick-off</p>}
          {remaining.length === 0 ? (
            <p className="dim mt-2" style={{ fontSize: 'var(--type-sm)' }}>{wholeSquad ? 'All players selected' : 'All available players selected'}</p>
          ) : (
            <div className="col gap-2 mt-2">
              {remaining.map((p) => (
                <motion.button key={p.id} type="button" className="card pick-row" onClick={() => assign(p.id)}
                  whileTap={reduced ? undefined : tap} transition={SPRING_SNAPPY}>
                  {p.photo_url ? <ClubImage sizes="40px" className="pick-av" src={p.photo_url} alt="" /> : <span className="pick-av mono">{initials(p.name)}</span>}
                  <span className="grow" style={{ textAlign: 'left' }}>{p.name}
                    {subs.includes(p.id) && <small>{starters[active] ? `On the bench · Swap with ${names[starters[active]]}` : 'On the bench'}</small>}
                  </span>
                  <span className={'tag ' + (ANSWER_TAG[p.status] ?? ANSWER_TAG.none).cls}><span className="status-light" aria-hidden="true" />{(ANSWER_TAG[p.status] ?? ANSWER_TAG.none).label}</span>
                </motion.button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="row gap-2 sheet-actions">
        <button className="btn btn-ghost grow" onClick={onDone}>Done</button>
        <button className="btn btn-primary grow" onClick={onSave}>Save line-up</button>
      </div>

      <style>{`
        .picker { border: 1px solid var(--line-2); border-radius: var(--r-card); padding: var(--space-3); background: var(--coal); }
        .pick-row { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); background: var(--slate);
          color: var(--bone); border: 1px solid var(--line); }
        .pick-av { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; flex: none;
          background: var(--coal); border: 1px solid var(--line-2); font-size: var(--type-xs); font-weight: 600;
          overflow: hidden; object-fit: cover; }
        img.pick-av { object-fit: cover; }
        .tag-in { color: var(--green-bright); border-color: var(--green); }
        .tag-maybe { color: var(--amber); border-color: var(--amber); }
        .tag-out { color: var(--red-bright); border-color: var(--red); }
      `}</style>
    </LayoutGroup>
  )
}
