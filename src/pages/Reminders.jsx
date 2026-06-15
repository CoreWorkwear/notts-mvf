import { useEffect, useState } from 'react'
import { useReminders } from '../hooks/useReminders'
import { OFFSET_CHOICES, offsetLabel } from '../lib/reminders'
import Toast from '../components/Toast'
import Loader from '../components/Loader'

// Admin: auto availability reminders. Turn them on and pick how long before
// kickoff the club gets nudged. The run-reminders Edge Function (hourly cron)
// does the sending; this just edits the config.
export default function Reminders() {
  const { settings, loading, save } = useReminders()
  const [enabled, setEnabled] = useState(false)
  const [offsets, setOffsets] = useState([48, 24])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    if (!settings) return
    setEnabled(!!settings.enabled)
    setOffsets(settings.offsets ?? [48, 24])
  }, [settings])

  const toggleOffset = (h) =>
    setOffsets((cur) => (cur.includes(h) ? cur.filter((x) => x !== h) : [...cur, h]).sort((a, b) => b - a))

  async function onSave() {
    if (enabled && offsets.length === 0) { setError('Pick at least one reminder time, or switch reminders off.'); return }
    setBusy(true); setError(null); setNotice(null)
    const { error } = await save({ enabled, offsets })
    setBusy(false)
    if (error) setError(error.message)
    else setNotice('Reminder settings saved 👍')
  }

  if (loading) return <Loader label="Loading reminders…" />

  const summary = enabled && offsets.length
    ? `Players get a nudge ${offsets.map(offsetLabel).join(' and ')} before kickoff.`
    : 'Reminders are off — nobody gets an automatic nudge.'

  return (
    <div className="page">
      <Toast message={error} tone="error" onDismiss={() => setError(null)} />
      <Toast message={notice} tone="success" onDismiss={() => setNotice(null)} />
      <p className="kicker"><span className="kicker-rule">REMINDERS</span></p>
      <h1 className="display mt-2" style={{ fontSize: 28 }}>Availability nudges</h1>
      <p className="muted mt-2" style={{ fontSize: 14 }}>
        Automatically push the squad to set their availability before a game — so you're not chasing everyone by hand.
      </p>

      <div className="card mt-4" style={{ padding: 16 }}>
        <div className="row spread" style={{ alignItems: 'center' }}>
          <span style={{ fontWeight: 600 }}>Auto reminders</span>
          <button className={'chip' + (enabled ? ' paid-on' : '')} aria-pressed={enabled} onClick={() => setEnabled((e) => !e)}>
            {enabled ? 'On ✓' : 'Off'}
          </button>
        </div>

        <div className={'mt-4' + (enabled ? '' : ' dim')} style={enabled ? {} : { opacity: 0.5, pointerEvents: 'none' }}>
          <p className="label">Send a reminder…</p>
          <div className="row gap-2 mt-2" style={{ flexWrap: 'wrap' }}>
            {OFFSET_CHOICES.map((c) => (
              <button key={c.hours} type="button" className="chip" aria-pressed={offsets.includes(c.hours)}
                onClick={() => toggleOffset(c.hours)}>
                {c.label} before
              </button>
            ))}
          </div>
        </div>

        <p className="dim mt-4" style={{ fontSize: 13 }}>{summary}</p>
      </div>

      <button className="btn btn-primary btn-block mt-4" disabled={busy} onClick={onSave}>
        {busy ? 'Saving…' : 'Save'}
      </button>

      <p className="dim mt-3" style={{ fontSize: 12 }}>
        Reminders only go to players who can be picked (signed-off, active, eligible) and who've turned notifications on.
      </p>
    </div>
  )
}
