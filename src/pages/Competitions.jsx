import { useEffect, useState } from 'react'
import { useSeason } from '../context/SeasonContext'
import { useCompetitions } from '../hooks/useCompetitions'
import { COMPETITION_TYPES, competitionTypeLabel, squadRuleSummary, validateCompetition } from '../lib/competitions'
import Sheet from '../components/Sheet'
import Toast from '../components/Toast'
import Loader from '../components/Loader'
import SquadPicker from '../components/SquadPicker'

// Admin: the competitions a club runs this season (league / cup / friendlies),
// each carrying its squad-registration rule (§2). Fixtures attach to these.
export default function Competitions() {
  const { seasonId, seasons } = useSeason()
  const { competitions, loading, save, remove } = useCompetitions(seasonId)
  const [editing, setEditing] = useState(null) // competition or null
  const [open, setOpen] = useState(false)
  const [squadFor, setSquadFor] = useState(null) // competition whose squad we're picking
  const seasonLabel = seasons?.find((s) => s.id === seasonId)?.label

  if (loading) return <Loader label="Loading competitions…" />

  return (
    <div className="page">
      <p className="kicker"><span className="kicker-rule">COMPETITIONS</span></p>
      <h1 className="display mt-2" style={{ fontSize: 28 }}>Competitions</h1>
      <p className="muted mt-2" style={{ fontSize: 13 }}>{seasonLabel ? `Season ${seasonLabel}.` : ''} Leagues, cups and friendly series. Each can cap a registered squad (§2).</p>

      <button className="btn btn-primary btn-block mt-3" onClick={() => { setEditing(null); setOpen(true) }}>+ Add a competition</button>

      {competitions.length === 0 ? (
        <div className="empty mt-5"><p className="empty-title">No competitions yet</p>
          <p>Add the league or cup you're playing in — then attach fixtures to it.</p></div>
      ) : (
        <div className="col gap-2 mt-4">
          {competitions.map((c) => (
            <div key={c.id} className="card comp-row">
              <button className="comp-main" onClick={() => { setEditing(c); setOpen(true) }}>
                <span className="comp-name">{c.name}</span>
                <span className="comp-sub">{competitionTypeLabel(c.type)} · {squadRuleSummary(c)}</span>
              </button>
              <button className="chip" onClick={() => setSquadFor(c)}>Squad</button>
            </div>
          ))}
        </div>
      )}

      <CompetitionForm open={open} competition={editing} onClose={() => setOpen(false)} onSave={save} onRemove={remove} />
      <SquadPicker open={!!squadFor} competition={squadFor} onClose={() => setSquadFor(null)} />

      <style>{`
        .comp-row { display: flex; align-items: center; gap: 12px; padding: 14px; background: var(--coal);
          color: var(--bone); border: 1px solid var(--line); }
        .comp-main { flex: 1; min-width: 0; background: none; border: none; color: inherit; text-align: left;
          display: flex; flex-direction: column; gap: 2px; cursor: pointer; padding: 0; }
        .comp-name { font-family: var(--font-display); font-weight: 600; font-size: 17px; }
        .comp-sub { font-size: 12px; color: var(--bone-mute); }
      `}</style>
    </div>
  )
}

function CompetitionForm({ open, competition, onClose, onSave, onRemove }) {
  const adding = !competition
  const [name, setName] = useState('')
  const [type, setType] = useState('league')
  const [limitOn, setLimitOn] = useState(false)
  const [limit, setLimit] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setError(null); setBusy(false)
    setName(competition?.name ?? '')
    setType(competition?.type ?? 'league')
    setLimitOn(!!competition?.squad_limit_enabled)
    setLimit(competition?.squad_limit ?? '')
  }, [open, competition])

  async function submit(e) {
    e.preventDefault()
    const draft = { id: competition?.id, name, type, squad_limit_enabled: limitOn, squad_limit: limit }
    const v = validateCompetition(draft)
    if (v) { setError(v); return }
    setBusy(true); setError(null)
    const { error } = await onSave(draft)
    setBusy(false)
    if (error) setError(error.message); else onClose()
  }

  async function del() {
    if (!confirm(`Delete "${name}"? Fixtures stay but lose their competition link.`)) return
    setBusy(true)
    const { error } = await onRemove(competition.id)
    setBusy(false)
    if (error) setError(error.message); else onClose()
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <Toast message={error} tone="error" onDismiss={() => setError(null)} />
      <p className="kicker"><span className="kicker-rule">{adding ? 'ADD COMPETITION' : 'EDIT COMPETITION'}</span></p>
      <h2 className="display mt-2" style={{ fontSize: 24 }}>{adding ? 'New competition' : name}</h2>

      <form className="col gap-3 mt-4" onSubmit={submit}>
        <div className="field"><label className="label">Name</label>
          <input className="input" aria-label="Name" value={name} placeholder="e.g. Notts Sunday League 2025/26" onChange={(e) => setName(e.target.value)} /></div>

        <div className="field"><label className="label">Type</label>
          <select className="select" aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
            {COMPETITION_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select></div>

        <div className="field"><label className="label">Registered squad</label>
          <div className="row gap-2">
            <button type="button" className="chip" aria-pressed={!limitOn} onClick={() => setLimitOn(false)}>No limit</button>
            <button type="button" className="chip" aria-pressed={limitOn} onClick={() => setLimitOn(true)}>Capped squad</button>
          </div>
          {limitOn && (
            <input className="input mt-2" type="number" min="1" aria-label="Squad size" value={limit}
              placeholder="e.g. 16" style={{ maxWidth: 140 }} onChange={(e) => setLimit(e.target.value)} />
          )}
          <span className="dim" style={{ fontSize: 12 }}>
            {limitOn ? 'The manager registers up to this many players for this competition.' : 'Any number of players can be registered.'}
          </span>
        </div>

        <button className="btn btn-primary btn-block mt-2" disabled={busy}>{busy ? 'Saving…' : adding ? 'Add competition' : 'Save changes'}</button>
        {!adding && (
          <button type="button" className="btn btn-ghost btn-block" disabled={busy} onClick={del}
            style={{ color: 'var(--red-bright)', borderColor: 'var(--line)' }}>Delete competition</button>
        )}
      </form>
    </Sheet>
  )
}
