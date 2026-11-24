import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTraining, createTrainingSessions, replyToTraining, getTrainingHeadcount, changeTrainingSession } from '../hooks/useTraining'
import { todayISO, addDaysISO, parseDate, fmtDate, hasKickedOff } from '../lib/format'
import { weekdayNames, recurrenceUnits, maxInterval, maxSessions, isoWeekday, previewRecurrence, recurrenceSummary } from '../lib/trainingRecurrence'
import PageHead from '../components/PageHead'
import Sheet from '../components/Sheet'
import TrainingNoticeInbox from '../components/TrainingNoticeInbox'
import { TrainingSessionCard, TrainingVenueDetails } from '../components/TrainingVenue'
import AttendanceRegister from '../components/AttendanceRegister'
import { usePaymentsRelease } from '../hooks/usePaymentsRelease'
import '../styles/training.css'

const audiences = { club: 'Whole club', xl: '1st Team', community: 'Community' }
const statuses = ['in', 'maybe', 'out']
const label = value => value[0].toUpperCase() + value.slice(1)
const monday = date => addDaysISO(date, -((parseDate(date).getDay() + 6) % 7))
const closed = session => session.cancelled || session.openForReplies === false || hasKickedOff(session.start_date, session.start_time)

function RepeatFields({ date, time, repeat, setRepeat, weekdays, preview, rule }) {
  const update = (key, value) => setRepeat({ ...repeat, [key]: value })
  const toggleDay = day => update('weekdays', weekdays.includes(day)
    ? weekdays.filter(item => item !== day)
    : [...weekdays, day].sort((a, b) => a - b))
  return <section className="training-repeat" aria-label="Recurrence">
    <label className="training-choice training-repeat-toggle">
      <input type="checkbox" checked={repeat.enabled} onChange={e => update('enabled', e.target.checked)} /> Recurring
    </label>
    {repeat.enabled && <div className="training-repeat-options">
      <div className="training-repeat-interval">
        <label>Repeat every<input required type="number" inputMode="numeric" min="1" max={maxInterval} step="1" value={repeat.interval} onChange={e => update('interval', e.target.value)} /></label>
        <label>Frequency<select value={repeat.frequency} onChange={e => update('frequency', e.target.value)}>
          {recurrenceUnits.map(unit => <option key={unit} value={unit}>{label(unit)}{Number(repeat.interval) === 1 ? '' : 's'}</option>)}
        </select></label>
      </div>
      {repeat.frequency === 'week' && <fieldset className="training-repeat-group">
        <legend>Repeat on</legend>
        <div className="training-repeat-days">{weekdayNames.map((day, index) => <label key={day} className="training-day-choice">
          <input type="checkbox" aria-label={day} checked={weekdays.includes(index + 1)} onChange={() => toggleDay(index + 1)} />
          <span aria-hidden="true">{day.slice(0, 3)}</span>
        </label>)}</div>
      </fieldset>}
      <fieldset className="training-repeat-group">
        <legend>Ends</legend>
        <div className="training-repeat-ending">
          <label className="training-choice"><input type="radio" name="training-ending" checked={repeat.ending === 'date'} onChange={() => update('ending', 'date')} /> On date</label>
          <label className="training-choice"><input type="radio" name="training-ending" checked={repeat.ending === 'count'} onChange={() => update('ending', 'count')} /> After</label>
        </div>
        {repeat.ending === 'date'
          ? <label>End date<input required type="date" min={date} value={repeat.until} onChange={e => update('until', e.target.value)} /></label>
          : <label>Number of sessions<input required type="number" inputMode="numeric" min="1" max={maxSessions} step="1" value={repeat.count} onChange={e => update('count', e.target.value)} /></label>}
      </fieldset>
      <p className="training-repeat-summary" aria-live="polite">{recurrenceSummary(date, time, rule, preview)}</p>
    </div>}
  </section>
}

const newRepeat = () => ({ enabled: false, frequency: 'week', interval: '1', weekdays: null, ending: 'count', count: '6', until: '' })

export function TrainingForm({ open, onClose, onSaved, onConflict, session }) {
  const editing = Boolean(session)
  const [fields, setFields] = useState({})
  const [repeat, setRepeat] = useState(newRepeat)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(null)
  const currentSession = useRef(session)
  const [latest, setLatest] = useState(null)
  const [refreshBlocked, setRefreshBlocked] = useState(false)
  useEffect(() => {
    if (!open) return
    setFields({ date: session?.start_date || todayISO(), time: session?.start_time?.slice(0, 5) || '19:00', venue: session?.venue || '', town: session?.town || '', address: session?.address || '', postcode: session?.postcode || '', w3w: session?.w3w || '', audience: session?.audience || 'club', focus: session?.focus || '' })
    setRepeat(newRepeat())
    setError(''); setLatest(null); setRefreshBlocked(false)
    currentSession.current = session
    request.current = null
  }, [open, session])
  const change = (key, value) => { setFields(old => ({ ...old, [key]: value })); request.current = null }
  const weekdays = repeat.weekdays ?? (fields.date ? [isoWeekday(fields.date)] : [])
  const rule = {
    frequency: repeat.frequency,
    interval: Number(repeat.interval),
    weekdays: repeat.frequency === 'week' ? weekdays : [],
    until: repeat.ending === 'date' ? repeat.until : null,
    count: repeat.ending === 'count' ? Number(repeat.count) : null,
  }
  const preview = repeat.enabled ? previewRecurrence(fields.date, rule) : null
  async function save(event) {
    event.preventDefault()
    if (busy || refreshBlocked) return
    if (editing && closed(currentSession.current)) { setError('This session is closed. Your changes have been kept.'); return }
    if (!fields.venue.trim() || !fields.town.trim()) { setError('Enter a venue and town.'); return }
    if (preview?.error) { setError(preview.error); return }
    setBusy(true); setError('')
    try {
      request.current ??= crypto.randomUUID()
      const values = { ...fields, venue: fields.venue.trim(), town: fields.town.trim(), focus: fields.focus.trim(), requestId: request.current }
      const savedId = editing
        ? await changeTrainingSession(currentSession.current, { ...values, cancel: false })
        : await createTrainingSessions({ ...values, recurrence: repeat.enabled ? rule : null })
      await onSaved(savedId, preview?.firstDate || fields.date); onClose()
    } catch (err) {
      if (editing && err.code === '40001' && onConflict) {
        const fresh = await onConflict(session.id)
        setRefreshBlocked(!fresh)
        if (fresh) { currentSession.current = fresh; setLatest(fresh) }
        setError(fresh ? 'Session changed. Review the latest details below, then save again. Your changes have been kept.' : 'Session could not refresh. Check your connection and save again. Your changes have been kept.')
      } else setError(`Training was not saved. ${err.message || 'Check your connection and try again.'}`)
    }
    finally { setBusy(false) }
  }
  return <Sheet open={open} onClose={busy ? () => {} : onClose} aria-label={editing ? "Edit training" : "Book training"}>
    <form className="training-form" onSubmit={save}><fieldset className="training-form-fields" disabled={busy}>
      <div className="training-sheet-head"><h2>{editing ? 'Edit training' : 'Book training'}</h2><button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>Close</button></div>
      <label>Date<input required type="date" value={fields.date || ''} onChange={e => change('date', e.target.value)} /></label>
      <label>Local start time<input required type="time" value={fields.time || ''} onChange={e => change('time', e.target.value)} /></label>
      {!editing && <RepeatFields date={fields.date} time={fields.time} repeat={repeat} weekdays={weekdays} rule={rule} preview={preview} setRepeat={next => { setRepeat(next); setError(''); request.current = null }} />}
      <label>Venue<input required maxLength={160} value={fields.venue || ''} onChange={e => change('venue', e.target.value)} /></label>
      <label>Address<input maxLength={300} autoComplete="street-address" value={fields.address || ''} onChange={e => change('address', e.target.value)} /></label>
      <div className="training-address-row">
        <label>Town<input required maxLength={100} autoComplete="address-level2" value={fields.town || ''} onChange={e => change('town', e.target.value)} /></label>
        <label>Postcode<input maxLength={16} autoComplete="postal-code" autoCapitalize="characters" value={fields.postcode || ''} onChange={e => change('postcode', e.target.value)} /></label>
      </div>
      <label>what3words<input maxLength={120} autoCapitalize="none" spellCheck={false} placeholder="///filled.count.soap" value={fields.w3w || ''} onChange={e => change('w3w', e.target.value)} /></label>
      <label>Invited squads<select disabled={editing} value={fields.audience || 'club'} onChange={e => change('audience', e.target.value)}>{Object.entries(audiences).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
      <label>Session focus (optional)<textarea maxLength={1000} value={fields.focus || ''} onChange={e => change('focus', e.target.value)} /></label>
      {error && <p role="alert">{error}</p>}{latest && <p>Latest session: {fmtDate(latest.start_date)} · {latest.start_time.slice(0, 5)} · {[latest.venue, latest.address, latest.town, latest.postcode, latest.w3w].filter(Boolean).join(', ')}{latest.cancelled ? " · Cancelled" : ""}</p>}
      {refreshBlocked && <button type="button" className="btn btn-ghost" onClick={async () => {
        setBusy(true)
        const fresh = await onConflict(session.id)
        if (fresh) { currentSession.current = fresh; setLatest(fresh); setRefreshBlocked(false); setError('Review the latest details, then save again. Your changes have been kept.') }
        setBusy(false)
      }}>Refresh latest details</button>}
      <button className="btn btn-primary" disabled={busy || refreshBlocked}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Publish training'}</button>
    </fieldset></form>
  </Sheet>
}

function Headcount({ session, refresh }) {
  const sessionId = session?.id
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!sessionId) return
    let active = true
    setRows(null); setError('')
    getTrainingHeadcount(sessionId).then(data => { if (active) setRows(data) }).catch(() => { if (active) setError('Headcount could not load. Try again.') })
    return () => { active = false }
  }, [sessionId, refresh, attempt])
  return <section className="training-headcount" aria-label="Training headcount"><h3>Who’s coming</h3>
    {error ? <div role="alert">{error}<button className="btn btn-ghost" onClick={() => setAttempt(n => n + 1)}>Retry headcount</button></div> : !rows ? <p role="status">Loading headcount…</p> : [...statuses, null].map(status => {
      const group = rows.filter(row => (row.status || null) === status)
      return <div key={status || 'none'}><h4>{status ? label(status) : 'No reply'} <span>{group.length}</span></h4>{group.length ? <ul>{group.map(row => <li key={row.profile_id}>{row.first_name} {row.last_name}</li>)}</ul> : <p>None</p>}</div>
    })}
  </section>
}

export default function Training() {
  const { user, profile, isAdmin, managerView } = useAuth()
  const payments = usePaymentsRelease(user?.id, profile?.club_id)
  const manager = isAdmin && managerView
  const { sessions = [], replies = {}, loading, error, reload } = useTraining()
  const { search, key: locationKey } = useLocation()
  const requested = new URLSearchParams(search).get('session')
  const [week, setWeek] = useState(monday(todayISO()))
  const [selected, setSelected] = useState(null)
  const [attendanceOpen, setAttendanceOpen] = useState(false)
  const attendanceOpener = useRef(null)
  useEffect(() => { setAttendanceOpen(false) }, [selected])
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const cancelRequest = useRef(null)
  const [busy, setBusy] = useState(false)
  const [replyError, setReplyError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [linkLoading, setLinkLoading] = useState(false)
  const [linkError, setLinkError] = useState(false)
  const [linkAttempt, setLinkAttempt] = useState(0)
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => tick(n => n + 1), 30000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!requested) return
    let active = true
    setSelected(null); setLinkLoading(true); setLinkError(false); setNeedsRefresh(false)
    reload().then(data => {
      if (!active) return
      setLinkLoading(false)
      if (!data) { setLinkError(true); return }
      const found = data.sessions.find(item => item.id === requested)
      if (found) { setSelected(found.id); setWeek(monday(found.start_date)); setConfirmCancel(false) }
    })
    return () => { active = false }
  }, [requested, locationKey, reload, linkAttempt])
  const session = sessions.find(item => item.id === selected)
  const weekEnd = addDaysISO(week, 6)
  const visible = sessions.filter(item => item.start_date >= week && item.start_date <= weekEnd).sort((a, b) => `${a.start_date}${a.start_time}`.localeCompare(`${b.start_date}${b.start_time}`))
  async function refreshCurrent() {
    setNeedsRefresh(true)
    const data = await reload()
    setNeedsRefresh(!data)
    setReplyError(data ? 'Session changed. Review the latest details and try again.' : 'Session could not refresh. Check your connection and retry.')
  }
  async function reply(status) {
    if (busy) return
    setBusy(true); setReplyError('')
    try { await replyToTraining(session, status); await reload(); setRefresh(n => n + 1) }
    catch (err) {
      if (err.code === '40001') await refreshCurrent()
      else setReplyError(`Reply was not saved. ${err.message || 'Check your connection and try again.'}`)
    }
    finally { setBusy(false) }
  }
  async function cancel() {
    if (busy) return
    setBusy(true); setReplyError('')
    try {
      cancelRequest.current ??= crypto.randomUUID()
      await changeTrainingSession(session, { requestId: cancelRequest.current, date: session.start_date, time: session.start_time, venue: session.venue, town: session.town, focus: session.focus, cancel: true })
      await reload(); setConfirmCancel(false); setRefresh(n => n + 1)
    } catch (err) {
      if (err.code === '40001') await refreshCurrent()
      else setReplyError(`Cancellation was not saved. ${err.message || 'Check your connection and try again.'}`)
    }
    finally { setBusy(false) }
  }
  return <div className="page training-page">
    <PageHead title="Training" aside={manager && <button className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true) }}>Book training</button>} />
    <TrainingNoticeInbox />
    {linkLoading && <p role="status">Refreshing session…</p>}
    {linkError && <p role="alert">Session could not refresh. <button className="btn btn-ghost" onClick={() => setLinkAttempt(n => n + 1)}>Retry session</button></p>}
    <div className="training-week-controls"><button className="btn btn-ghost" aria-label="Previous week" onClick={() => setWeek(addDaysISO(week, -7))}>Previous</button><button className="btn btn-ghost" onClick={() => setWeek(monday(todayISO()))}>This week</button><button className="btn btn-ghost" aria-label="Next week" onClick={() => setWeek(addDaysISO(week, 7))}>Next</button></div>
    <h2 className="training-week-title"><time dateTime={week}>{fmtDate(week)}</time> – <time dateTime={weekEnd}>{fmtDate(weekEnd)} {weekEnd.slice(0, 4)}</time></h2>
    <label className="training-jump">Go to date<input type="date" value={week} onChange={e => { if (e.target.value) setWeek(monday(e.target.value)) }} /></label>
    {loading ? <p role="status">Loading training…</p> : error ? <div role="alert"><p>Training could not load. Check your connection and try again.</p><button className="btn btn-ghost" onClick={reload}>Retry training</button></div> : <>
      {requested && !linkLoading && !linkError && !sessions.some(item => item.id === requested) && <p role="status">This session is unavailable for your account.</p>}
      <div className="training-agenda">{Array.from({ length: 7 }, (_, index) => addDaysISO(week, index)).map(day =>
        <section className="training-day" key={day}>
          <h3><time dateTime={day}>{fmtDate(day)}</time></h3>
          {visible.filter(item => item.start_date === day).map(item => <TrainingSessionCard key={item.id}
            session={item} audience={audiences[item.audience]}
            status={item.cancelled ? 'Cancelled' : closed(item) ? 'Started' : replies[item.id] ? `You’re ${replies[item.id]}` : 'View session'}
            onOpen={() => { setSelected(item.id); setReplyError(''); setConfirmCancel(false); cancelRequest.current = null }} />)}
        </section>)}</div>
      {!visible.length && <p className="training-empty">No training this week.</p>}
    </>}
    <Sheet open={!!session} onClose={() => setSelected(null)} aria-label="Training session">{session && <div className="training-detail"><div className="training-sheet-head"><h2>{audiences[session.audience]} training</h2><button className="btn btn-ghost" disabled={busy} onClick={() => setSelected(null)}>Close</button></div><p><time dateTime={`${session.start_date}T${session.start_time}`}>{fmtDate(session.start_date)} {session.start_date.slice(0, 4)} · {session.start_time.slice(0, 5)}</time></p><TrainingVenueDetails key={session.id} session={session} />{session.focus && <p className="training-focus">{session.focus}</p>}
      {closed(session) ? <p role="status">{session.cancelled ? 'Cancelled' : 'Started'}{replies[session.id] && ` · Your reply: ${label(replies[session.id])}`}</p> : session.canReply ? <fieldset className="training-replies" disabled={busy || needsRefresh}><legend>Your availability</legend>{statuses.map(status => <button type="button" className={`btn training-reply training-reply-${status}`} key={status} aria-pressed={replies[session.id] === status} onClick={() => reply(status)}>{label(status)}</button>)}</fieldset> : <p>Availability · Invited players only</p>}
      {replyError && <p role="alert">{replyError}</p>}{needsRefresh && <button className="btn btn-ghost" onClick={refreshCurrent}>Retry latest details</button>}{busy && <p role="status">Saving…</p>}{manager && <><Headcount session={session} refresh={refresh} />{!closed(session) && <div className="training-manager-actions">{confirmCancel ? <><p>Cancel this session? Club members will be notified. Saved replies will be retained.</p><button className="btn btn-danger" disabled={busy || needsRefresh} onClick={cancel}>Confirm cancellation</button><button className="btn btn-ghost" disabled={busy} onClick={() => setConfirmCancel(false)}>Keep session</button></> : <><button className="btn btn-ghost" disabled={busy || needsRefresh} onClick={() => { setEditing(session); setSelected(null); setFormOpen(true) }}>Edit session</button><button className="btn btn-ghost" disabled={busy || needsRefresh} onClick={() => { setConfirmCancel(true); cancelRequest.current = null }}>Cancel session</button></>}</div>}</>}
      {manager && payments.enabled && (!attendanceOpen ? <button type="button" ref={attendanceOpener} className="btn btn-primary btn-block mt-5" onClick={() => setAttendanceOpen(true)}>Confirm who attended</button> : <AttendanceRegister key={`attendance-${session.id}`} mode="training" sessionId={session.id} onClose={() => { setAttendanceOpen(false); requestAnimationFrame(() => attendanceOpener.current?.focus()) }} />)}
    </div>}</Sheet>
    <TrainingForm open={formOpen} session={editing} onConflict={async id => { const data = await reload(); return data?.sessions.find(item => item.id === id) }} onClose={() => setFormOpen(false)} onSaved={async (id, date) => { await reload(); setWeek(monday(date)); setSelected(editing?.id || id) }} />
  </div>
}
