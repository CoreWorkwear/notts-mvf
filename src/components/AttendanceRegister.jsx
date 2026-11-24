import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { usePlayers } from '../hooks/usePlayers'
import { supabase } from '../lib/supabase'
import { fmtDateLong } from '../lib/format'
import './AttendanceRegister.css'

const drafts = new Map()
function readPending(key) {
  if (drafts.has(key)) return drafts.get(key)
  try {
    const draft = JSON.parse(sessionStorage.getItem(key))
    if (draft?.payload?.p_request_id && Array.isArray(draft.payload.p_profile_ids)) return draft
  } catch { /* In-memory recovery remains available. */ }
  return null
}
function writePending(key, draft) {
  if (draft) drafts.set(key, draft)
  else drafts.delete(key)
  try {
    if (draft) sessionStorage.setItem(key, JSON.stringify(draft))
    else sessionStorage.removeItem(key)
  } catch { /* Keep the in-memory copy when session storage is unavailable. */ }
}

const adapters = {
  match: { read: 'get_fixture_appearance_register', write: 'confirm_fixture_appearances', idKey: 'p_fixture_id' },
  training: { read: 'get_training_attendance_register', write: 'confirm_training_attendance', idKey: 'p_session_id' },
}

export default function AttendanceRegister({ fixtureId, sessionId, mode = 'match', onClose }) {
  const { user, profile } = useAuth()
  const { players } = usePlayers()
  const training = mode === 'training'
  const occurrenceId = training ? sessionId : fixtureId
  const adapter = adapters[mode] ?? adapters.match
  const subject = training ? 'session' : 'fixture'
  const key = `mvf:attendance:${user?.id}:${profile?.club_id}:${training ? 'training:' : ''}${occurrenceId}`
  const [recovered] = useState(() => readPending(key))
  const pending = useRef(recovered)
  const ambiguous = useRef(!!recovered)
  const inFlight = useRef(false)
  const heading = useRef(null)
  const [register, setRegister] = useState(null)
  const [selected, setSelected] = useState(recovered?.payload.p_profile_ids ?? [])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [locked, setLocked] = useState(!!recovered)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [stale, setStale] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView?.({ block: 'start' }) }, [])
  useEffect(() => {
    let active = true
    setLoading(true); setLoadError(false); setRegister(null)
    Promise.resolve().then(() => supabase.rpc(adapter.read, { [adapter.idKey]: occurrenceId })).then(({ data, error }) => {
      if (error || !Array.isArray(data?.confirmed_profile_ids) || !Array.isArray(data?.players) || !Number.isInteger(data.revision) || typeof data.occurrence_fingerprint !== 'string') throw error ?? new Error('Invalid attendance register')
      if (!active) return
      setRegister(data)
      if (!pending.current) { setSelected(data.confirmed_profile_ids); setStale(false); setError('') }
    }).catch(() => { if (active) setLoadError(true) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [occurrenceId, adapter, attempt])

  const names = Object.fromEntries(players.map(player => [player.id, `${player.first_name} ${player.last_name}`]))
  const candidates = register?.players ?? []
  const missingSelected = selected.filter(id => !candidates.some(player => player.profile_id === id))
  // A cancelled/postponed fixture may be cleared to reverse its existing fees.
  // It can never gain an appearance while the server says it cannot confirm.
  const adding = selected.some(id => !register?.confirmed_profile_ids.includes(id))
  const changing = register && (adding || register.confirmed_profile_ids.some(id => !selected.includes(id)))
  const needsRate = adding && !register?.rate
  const allowedState = register?.can_confirm || (register?.allow_clear && selected.length === 0)
  const canSave = locked || (register && !stale && allowedState && !needsRate)
  function toggle(id) {
    setSaved(false)
    setSelected(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id])
  }
  async function save(event) {
    event.preventDefault()
    if (inFlight.current || !register || !canSave) return
    if (!pending.current) {
      pending.current = { payload: { p_request_id: crypto.randomUUID(), [adapter.idKey]: occurrenceId, p_expected_revision: register.revision, p_occurrence_fingerprint: register.occurrence_fingerprint, p_profile_ids: [...selected].sort() }, names: Object.fromEntries(candidates.map(player => [player.profile_id, player.player_name || names[player.profile_id]])) }
      writePending(key, pending.current); setLocked(true)
    }
    setError(''); setSaved(false); setSaving(true); inFlight.current = true
    try {
      const { data, error } = await supabase.rpc(adapter.write, pending.current.payload)
      if (error || !Array.isArray(data?.confirmed_profile_ids)) throw error ?? new Error('No attendance confirmation')
      writePending(key, null); pending.current = null; ambiguous.current = false
      setLocked(false); setRegister(data); setSelected(data.confirmed_profile_ids); setSaved(true)
      setAttempt(value => value + 1)
    } catch (failure) {
      if (!ambiguous.current && ['40001', '22023', '42501'].includes(failure?.code)) {
        writePending(key, null); pending.current = null; setLocked(false); setStale(true)
        setError(failure.code === '40001' ? 'Attendance changed since you opened it. Refresh attendance before making changes.' : failure.code === '42501' ? 'Attendance was not saved. Player accounts may be paused or your access has changed. Refresh attendance before trying again.' : `Attendance was not saved. The ${subject} or its fee may have changed. Refresh attendance before trying again.`)
      } else {
        ambiguous.current = true
        setError(failure?.code === '42501' ? 'Player accounts may be paused. This attendance still needs confirmation. Retry the same attendance when accounts are available.' : "Couldn't confirm attendance. Retry the same attendance to check and save it once.")
      }
    } finally { setSaving(false); inFlight.current = false }
  }

  return <section className="attendance-register mt-5" aria-labelledby={`${mode}-attendance-heading`}>
    <h2 id={`${mode}-attendance-heading`} ref={heading} tabIndex={-1}>{training ? 'Training attendance' : 'Match attendance'}</h2>
    <p className="muted mt-2">{training ? 'Tick only players who actually attended. Advance replies do not confirm attendance.' : 'Tick only players who took part, including substitutes who came on. Selection and availability do not confirm an appearance.'}</p>
    {loading ? <p role="status" className="mt-3">Loading attendance…</p> : loadError ? <div role="alert" className="mt-3"><p>Couldn't load attendance. No changes have been made.</p><button className="btn btn-ghost mt-2" onClick={() => setAttempt(value => value + 1)}>Try again</button></div> : register && <>
      <p className="mt-3">{fmtDateLong(register.activity_date)} · {register.rate ? `${new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(register.rate.amount_pence / 100)} per ${training ? 'attendee' : 'appearance'}` : `No ${training ? 'training' : 'match'} fee is set for this date.`}</p>
      {!register.can_confirm && <p role="status" className="mt-2">This {subject} cannot gain new {training ? 'attendees' : 'appearances'}{register.unavailable_reason ? `: ${register.unavailable_reason.replaceAll('_', ' ')}` : '.'}{register.allow_clear ? ` Clear all existing ${training ? 'attendees' : 'appearances'} to reverse their fees.` : ` No ${training ? 'training' : 'match'} fees can be confirmed.`}</p>}
      {!register.rate && <p className="muted mt-2">A manager must set the fee in Club settings before new {training ? 'attendance' : 'appearances'} can be confirmed.</p>}
      {recovered && locked && <p role="status" className="mt-2">An earlier attendance save still needs confirmation. Its player list is kept unchanged for retry.</p>}
      {saved && <p role="status" className="mt-2">Attendance saved. Showing the current confirmed {training ? 'attendees' : 'appearances'}.</p>}
      <form className="col gap-3 mt-3" onSubmit={save}>
        <fieldset className="attendance-options" disabled={locked || saving || stale}><legend>{training ? 'Players who attended' : 'Players who took part'}</legend>
          {candidates.map(player => <label className="attendance-person" key={player.profile_id}>
            <input type="checkbox" aria-label={player.player_name || names[player.profile_id] || 'Player'} checked={selected.includes(player.profile_id)} disabled={(!player.eligible || !register.can_confirm) && !selected.includes(player.profile_id)} onChange={() => toggle(player.profile_id)} />
            <span>{player.player_name || names[player.profile_id] || 'Player'}{player.waived && <small className="muted"> · Fee waived</small>}{!player.eligible && <small className="muted"> · No longer eligible</small>}</span>
          </label>)}
          {missingSelected.map(id => <label key={id} className="attendance-person"><input type="checkbox" checked disabled /><span>{pending.current?.names[id] || names[id] || 'Previously confirmed player'}</span></label>)}
          {candidates.length === 0 && <p className="muted">No eligible players are available.</p>}
        </fieldset>
        <p className="mono">{selected.length} {training ? 'attendees' : 'appearances'} selected{changing ? ' · Unsaved changes' : ''}</p>
        {error && <p role="alert" className="field-error">{error}</p>}
        <div className="attendance-actions"><button className="btn btn-primary btn-block" disabled={saving || !canSave}>{saving ? 'Saving…' : locked ? 'Retry attendance' : 'Save attendance'}</button></div>
      </form>
      <button type="button" className="btn btn-ghost btn-block mt-3" disabled={saving} onClick={() => { setSaved(false); setAttempt(value => value + 1) }}>Refresh attendance</button>
    </>}
    <button type="button" className="btn btn-ghost btn-block mt-3" disabled={saving} onClick={onClose}>Cancel</button>
  </section>
}
