import { useEffect, useState } from 'react'
import { useReminders } from '../hooks/useReminders'
import { OFFSET_CHOICES, CUTOFF_HOURS, offsetLabel } from '../lib/reminders'
import Toast from '../components/Toast'
import Loader from '../components/Loader'

// Admin: auto reminders. Two independent types, each with its OWN periods:
//   • Availability nudges → not-replied + maybe, "set your availability"
//   • Match reminders     → in + maybe, the match details
export default function Reminders() {
  const { settings, loading, save } = useReminders()
  const [availabilityEnabled, setAvailabilityEnabled] = useState(false)
  const [matchEnabled, setMatchEnabled] = useState(false)
  const [availabilityOffsets, setAvailabilityOffsets] = useState([336, 168, 72])
  const [matchOffsets, setMatchOffsets] = useState([72, 24])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    if (!settings) return
    setAvailabilityEnabled(!!settings.availability_enabled)
    setMatchEnabled(!!settings.match_enabled)
    setAvailabilityOffsets(settings.availability_offsets ?? [336, 168, 72])
    setMatchOffsets(settings.match_offsets ?? [72, 24])
  }, [settings])

  const sortDesc = (a, b) => b - a
  const toggle = (setter) => (h) => setter((cur) => (cur.includes(h) ? cur.filter((x) => x !== h) : [...cur, h]).sort(sortDesc))

  async function onSave() {
    if (availabilityEnabled && availabilityOffsets.length === 0) { setError('Availability nudges are on but have no times picked.'); return }
    if (matchEnabled && matchOffsets.length === 0) { setError('Match reminders are on but have no times picked.'); return }
    setBusy(true); setError(null); setNotice(null)
    const { error } = await save({ availabilityEnabled, matchEnabled, availabilityOffsets, matchOffsets })
    setBusy(false)
    if (error) setError(error.message)
    else setNotice('Reminder settings saved 👍')
  }

  if (loading) return <Loader label="Loading reminders…" />

  return (
    <div className="page">
      <Toast message={error} tone="error" onDismiss={() => setError(null)} />
      <Toast message={notice} tone="success" onDismiss={() => setNotice(null)} />
      <p className="kicker"><span className="kicker-rule">REMINDERS</span></p>
      <h1 className="display mt-2" style={{ fontSize: 28 }}>Auto reminders</h1>
      <p className="muted mt-2" style={{ fontSize: 14 }}>
        Two kinds of nudge, each with its own timings. Availability usually closes ~3 days out — times after that ( <b>*</b> ) are your call.
      </p>

      <ReminderBlock
        title="Availability nudges"
        who="Goes to players who've not replied or said maybe — chasing the undecided."
        enabled={availabilityEnabled} setEnabled={setAvailabilityEnabled}
        offsets={availabilityOffsets} onToggle={toggle(setAvailabilityOffsets)}
      />
      <ReminderBlock
        title="Match reminders"
        who="Goes to players who said in or maybe — the match details before kickoff."
        enabled={matchEnabled} setEnabled={setMatchEnabled}
        offsets={matchOffsets} onToggle={toggle(setMatchOffsets)}
      />

      <button className="btn btn-primary btn-block mt-4" disabled={busy} onClick={onSave}>
        {busy ? 'Saving…' : 'Save'}
      </button>
      <p className="dim mt-3" style={{ fontSize: 12 }}>Reminders only reach players with notifications turned on.</p>
    </div>
  )
}

function ReminderBlock({ title, who, enabled, setEnabled, offsets, onToggle }) {
  return (
    <div className="card mt-3" style={{ padding: 16 }}>
      <div className="row spread" style={{ alignItems: 'flex-start' }}>
        <div style={{ paddingRight: 12 }}>
          <span style={{ fontWeight: 600 }}>{title}</span>
          <p className="dim" style={{ fontSize: 12, marginTop: 2 }}>{who}</p>
        </div>
        <button className={'chip' + (enabled ? ' paid-on' : '')} aria-pressed={enabled} onClick={() => setEnabled((e) => !e)}>
          {enabled ? 'On ✓' : 'Off'}
        </button>
      </div>

      <div className={'mt-3' + (enabled ? '' : ' dim')} style={enabled ? {} : { opacity: 0.5, pointerEvents: 'none' }}>
        <p className="label">Send…</p>
        <div className="row gap-2 mt-2" style={{ flexWrap: 'wrap' }}>
          {OFFSET_CHOICES.map((c) => {
            const discretionary = c.hours < CUTOFF_HOURS
            return (
              <button key={c.hours} type="button" className="chip" aria-pressed={offsets.includes(c.hours)}
                onClick={() => onToggle(c.hours)}>
                {c.label} before{discretionary ? ' *' : ''}
              </button>
            )
          })}
        </div>
        <p className="dim mt-3" style={{ fontSize: 12 }}>
          {offsets.length ? `Firing ${offsets.map(offsetLabel).join(', ')} before kickoff.` : 'No times picked.'}
        </p>
      </div>
    </div>
  )
}
