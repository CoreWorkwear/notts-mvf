import { useEffect, useState } from 'react'
import Sheet from './Sheet'
import Toast from './Toast'
import { validateSeason } from '../lib/seasons'

// Add/edit a season (BUILD-LIST A3). "Make this the current season" is the
// rollover switch — it scopes the app to the new season (players + opponents
// carry; fixtures/results/table/stats are per-season, so the new one starts fresh).
export default function SeasonForm({ open, onClose, onSave, season }) {
  const editing = !!season
  const [label, setLabel] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [makeCurrent, setMakeCurrent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setLabel(season?.label ?? '')
    setStartDate(season?.start_date ?? '')
    setEndDate(season?.end_date ?? '')
    setMakeCurrent(season?.is_current ?? !editing) // new seasons default to becoming current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function onSubmit(e) {
    e.preventDefault()
    const v = validateSeason({ label, start_date: startDate, end_date: endDate })
    if (v) { setError(v); return }
    setBusy(true); setError(null)
    try {
      await onSave({ id: season?.id, label, start_date: startDate || null, end_date: endDate || null, makeCurrent })
      onClose()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <Toast message={error} onDismiss={() => setError(null)} />
      <p className="kicker"><span className="kicker-rule">{editing ? 'EDIT SEASON' : 'NEW SEASON'}</span></p>
      <h2 className="display mt-2" style={{ fontSize: 24 }}>{editing ? label : 'New season'}</h2>

      <form className="col gap-3 mt-4" onSubmit={onSubmit}>
        <div className="field">
          <label className="label">Label</label>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. 2026/27" />
        </div>
        <div className="row gap-2">
          <div className="field grow"><label className="label">Start date</label>
            <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
          <div className="field grow"><label className="label">End date</label>
            <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
        </div>

        <button type="button" className={'chip' + (makeCurrent ? ' paid-on' : '')} aria-pressed={makeCurrent} onClick={() => setMakeCurrent((v) => !v)}>
          {makeCurrent ? 'Current season ✓' : 'Make this the current season'}
        </button>
        {makeCurrent && !editing && (
          <p className="dim" style={{ fontSize: 12 }}>
            Rolling over: players &amp; opponents carry forward; fixtures, results, the table and stats start fresh.
            Old seasons stay viewable in the picker. Mark any leavers inactive over in Players.
          </p>
        )}

        <button className="btn btn-primary btn-block mt-2" disabled={busy}>
          {busy ? 'Saving…' : editing ? 'Save season' : 'Create season'}
        </button>
      </form>
    </Sheet>
  )
}
