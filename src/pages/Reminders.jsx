import { useEffect, useState } from 'react'
import { useReminders } from '../hooks/useReminders'
import { OFFSET_CHOICES } from '../lib/reminders'
import Toast from '../components/Toast'
import Loader from '../components/Loader'
import PageHead from '../components/PageHead'

// Admin: auto reminders. Two independent types, each with its OWN periods:
//   • Availability nudges → not-replied + maybe, "set your availability"
//   • Match reminders     → in + maybe, the match details
export default function Reminders() {
  const { settings, loading, error: loadError, save, refetch } = useReminders()
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
    if (availabilityEnabled && availabilityOffsets.length === 0) { setError('Choose an availability reminder time.'); return }
    if (matchEnabled && matchOffsets.length === 0) { setError('Choose a match reminder time.'); return }
    setBusy(true); setError(null); setNotice(null)
    const { error } = await save({ availabilityEnabled, matchEnabled, availabilityOffsets, matchOffsets })
    setBusy(false)
    if (error) setError(error.message)
    else setNotice('Reminder settings saved')
  }

  // Only the first load gets the Loader — a post-save refetch keeps the form up.
  if (loading && !settings) return <Loader route="reminders" label="Loading reminders…" />

  // A failed load is NOT "no settings yet". The form used to render its
  // defaults (both OFF) here, and Save upserted them over the club's real
  // settings with a success toast. No settings, no Save — retry instead.
  if (loadError && !settings) return (
    <div className="page">
      <div className="empty mt-5" role="alert">
        <p className="empty-title">Couldn't load the reminders</p>
        <button className="btn btn-primary mt-3" onClick={refetch}>Try again</button>
      </div>
    </div>
  )

  return (
    <div className="page">
      <Toast message={error} tone="error" onDismiss={() => setError(null)} />
      <Toast message={notice} tone="success" onDismiss={() => setNotice(null)} />
      <PageHead kicker="REMINDERS" title="Auto reminders" />

      <ReminderBlock
        title="Availability nudges"
        who="Recipients · Not replied or Maybe"
        enabled={availabilityEnabled} setEnabled={setAvailabilityEnabled}
        offsets={availabilityOffsets} onToggle={toggle(setAvailabilityOffsets)}
      />
      <ReminderBlock
        title="Match reminders"
        who="Recipients · In or Maybe"
        enabled={matchEnabled} setEnabled={setMatchEnabled}
        offsets={matchOffsets} onToggle={toggle(setMatchOffsets)}
      />

      <button className="btn btn-primary btn-block mt-4" disabled={busy} onClick={onSave}>
        {busy ? 'Saving…' : 'Save'}
      </button>
      <p className="dim mt-3" style={{ fontSize: 'var(--type-caption)' }}>Delivery · Players with notifications on</p>
    </div>
  )
}

function ReminderBlock({ title, who, enabled, setEnabled, offsets, onToggle }) {
  return (
    <div className="card mt-3" style={{ padding: 'var(--space-4)' }}>
      <div className="row spread" style={{ alignItems: 'flex-start' }}>
        <div style={{ paddingRight: 'var(--space-3)' }}>
          <span style={{ fontWeight: 600 }}>{title}</span>
          <p className="dim" style={{ fontSize: 'var(--type-caption)', marginTop: 'var(--space-1)' }}>{who}</p>
        </div>
        <button className={'chip' + (enabled ? ' paid-on' : '')} aria-pressed={enabled} onClick={() => setEnabled((e) => !e)}>
          {enabled ? 'On ✓' : 'Off'}
        </button>
      </div>

      <div className="mt-3">
        <p className="label">Before kick-off</p>
        <div className="row gap-2 mt-2" style={{ flexWrap: 'wrap' }}>
          {OFFSET_CHOICES.map((c) => {
            return (
              <button key={c.hours} type="button" className="chip" aria-pressed={offsets.includes(c.hours)} disabled={!enabled}
                onClick={() => onToggle(c.hours)}>
                {c.label} before
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
