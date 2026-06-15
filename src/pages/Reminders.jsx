import { useEffect, useState } from 'react'
import { useReminders } from '../hooks/useReminders'
import { OFFSET_CHOICES, CUTOFF_HOURS, offsetLabel } from '../lib/reminders'
import Toast from '../components/Toast'
import Loader from '../components/Loader'

// Admin: auto reminders. Two types, one shared set of periods:
//   • Availability nudges → the squad, "set your availability"
//   • Match reminders     → players who said in/maybe, the match details
// The run-reminders Edge Function (hourly cron) does the sending.
export default function Reminders() {
  const { settings, loading, save } = useReminders()
  const [availabilityEnabled, setAvailabilityEnabled] = useState(false)
  const [matchEnabled, setMatchEnabled] = useState(false)
  const [offsets, setOffsets] = useState([336, 168, 72])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    if (!settings) return
    setAvailabilityEnabled(!!settings.availability_enabled)
    setMatchEnabled(!!settings.match_enabled)
    setOffsets(settings.offsets ?? [336, 168, 72])
  }, [settings])

  const anyOn = availabilityEnabled || matchEnabled
  const toggleOffset = (h) =>
    setOffsets((cur) => (cur.includes(h) ? cur.filter((x) => x !== h) : [...cur, h]).sort((a, b) => b - a))

  async function onSave() {
    if (anyOn && offsets.length === 0) { setError('Pick at least one reminder time, or switch the reminders off.'); return }
    setBusy(true); setError(null); setNotice(null)
    const { error } = await save({ availabilityEnabled, matchEnabled, offsets })
    setBusy(false)
    if (error) setError(error.message)
    else setNotice('Reminder settings saved 👍')
  }

  if (loading) return <Loader label="Loading reminders…" />

  const periodText = offsets.length ? offsets.map(offsetLabel).join(', ') + ' before kickoff' : 'no times picked'

  return (
    <div className="page">
      <Toast message={error} tone="error" onDismiss={() => setError(null)} />
      <Toast message={notice} tone="success" onDismiss={() => setNotice(null)} />
      <p className="kicker"><span className="kicker-rule">REMINDERS</span></p>
      <h1 className="display mt-2" style={{ fontSize: 28 }}>Auto reminders</h1>
      <p className="muted mt-2" style={{ fontSize: 14 }}>
        Push the squad before a game — so you're not chasing everyone by hand. Both types fire at the times you pick below.
      </p>

      {/* Reminder types */}
      <div className="card mt-4" style={{ padding: 16 }}>
        <div className="row spread" style={{ alignItems: 'flex-start' }}>
          <div style={{ paddingRight: 12 }}>
            <span style={{ fontWeight: 600 }}>Availability nudges</span>
            <p className="dim" style={{ fontSize: 12, marginTop: 2 }}>To the squad — "you in?" to set availability.</p>
          </div>
          <button className={'chip' + (availabilityEnabled ? ' paid-on' : '')} aria-pressed={availabilityEnabled} onClick={() => setAvailabilityEnabled((e) => !e)}>
            {availabilityEnabled ? 'On ✓' : 'Off'}
          </button>
        </div>
        <div className="row spread mt-4" style={{ alignItems: 'flex-start' }}>
          <div style={{ paddingRight: 12 }}>
            <span style={{ fontWeight: 600 }}>Match reminders</span>
            <p className="dim" style={{ fontSize: 12, marginTop: 2 }}>To players who said in / maybe — the match details.</p>
          </div>
          <button className={'chip' + (matchEnabled ? ' paid-on' : '')} aria-pressed={matchEnabled} onClick={() => setMatchEnabled((e) => !e)}>
            {matchEnabled ? 'On ✓' : 'Off'}
          </button>
        </div>
      </div>

      {/* Shared periods */}
      <div className="card mt-3" style={{ padding: 16 }}>
        <div className={anyOn ? '' : 'dim'} style={anyOn ? {} : { opacity: 0.5, pointerEvents: 'none' }}>
          <p className="label">Send reminders…</p>
          <div className="row gap-2 mt-2" style={{ flexWrap: 'wrap' }}>
            {OFFSET_CHOICES.map((c) => {
              const discretionary = c.hours < CUTOFF_HOURS
              return (
                <button key={c.hours} type="button" className="chip" aria-pressed={offsets.includes(c.hours)}
                  onClick={() => toggleOffset(c.hours)} title={discretionary ? 'After the usual 3-day cut-off — your call' : undefined}>
                  {c.label} before{discretionary ? ' *' : ''}
                </button>
              )
            })}
          </div>
          <p className="dim mt-3" style={{ fontSize: 12 }}>
            Availability usually closes ~3 days out. <b>*</b> later than that — your discretion.
          </p>
        </div>
        <p className="dim mt-3" style={{ fontSize: 13 }}>
          {anyOn ? `Firing ${periodText}.` : 'Both reminder types are off.'}
        </p>
      </div>

      <button className="btn btn-primary btn-block mt-4" disabled={busy} onClick={onSave}>
        {busy ? 'Saving…' : 'Save'}
      </button>

      <p className="dim mt-3" style={{ fontSize: 12 }}>
        Reminders only reach players with notifications on. Availability nudges go to anyone who can be picked; match reminders only to those already in or maybe.
      </p>
    </div>
  )
}
