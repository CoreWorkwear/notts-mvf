import { useEffect, useState } from 'react'
import Sheet from './Sheet'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useOpponents } from '../hooks/useOpponents'
import { sortStandings } from '../lib/stats'
import { teamLabel, teamMatchName } from '../lib/teams'
import { friendlyError } from '../lib/errors'

// Manual league table, per COMPETITION / per season (§1.5). View shows pos, team,
// P, GD, Pts, W-D-L with our row highlighted; admin edits the grid (team names
// free-typed or picked from opponents). We re-sort by pts → GD → GF on display.
export default function LeagueTablePanel({ table, competitions = [], teams = [], seasonId, onSaved }) {
  const { isAdmin } = useAuth()
  const { opponents } = useOpponents()
  // Only ACTIVE leagues show here (retired ones keep their history but drop out),
  // ordered by sort_order so the First Team league is the default + first.
  const comps = competitions.filter((c) => c.active !== false)
  const [competitionId, setCompetitionId] = useState(comps[0]?.id ?? '')
  const [editing, setEditing] = useState(false)

  // Keep a valid selection as competitions load/change.
  useEffect(() => {
    if (comps.length && !comps.some((c) => c.id === competitionId)) setCompetitionId(comps[0].id)
  }, [comps, competitionId])

  // The manual table stores plain text. Resolve an old club squad label to its
  // competitive name and leave the names supplied for opponents alone.
  const clubNames = new Map(teams.map((team) => [teamLabel(team), teamMatchName(team)]))
  const ourNames = new Set(clubNames.values())
  const opponentNames = new Set(opponents.map((opponent) => opponent.name))
  const currentTable = table.filter((row) => row.competition_id === competitionId).map((row) => {
    if (opponentNames.has(row.team_name)) return row
    const matchName = clubNames.get(teamLabel({ label: row.team_name }))
    return matchName && matchName !== row.team_name
      ? { ...row, team_name: matchName, storedName: row.team_name }
      : row
  })
  const rows = sortStandings(currentTable)

  if (comps.length === 0) {
    return (
      <div className="empty mt-5">
        <p className="empty-title">No competitions yet</p>
        {isAdmin && <p>Manage → Competitions</p>}
      </div>
    )
  }

  return (
    <div className="mt-4">
      {comps.length > 1 && (
        <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
          {comps.map((c) => (
            <button key={c.id} className="chip" aria-pressed={competitionId === c.id} onClick={() => setCompetitionId(c.id)}>{c.name}</button>
          ))}
        </div>
      )}

      {isAdmin && (
        <button className="btn btn-ghost btn-block mt-3" onClick={() => setEditing(true)}>
          {rows.length ? 'Edit table' : 'Build the table'}
        </button>
      )}

      {rows.length === 0 ? (
        <div className="empty mt-4">
          <p className="empty-title">No table entries</p>
        </div>
      ) : (
        <table className="lt mt-3">
          <thead>
            <tr><th scope="col">#</th><th scope="col" className="lt-team">Team</th><th scope="col">P</th><th scope="col">GD</th><th scope="col">Pts</th><th scope="col" className="lt-form">W-D-L</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const ours = ourNames.has(r.team_name)
              return (
                <tr key={r.id} className={ours ? 'lt-ours' : ''}>
                  <td className="mono">{i + 1}</td>
                  <td className="lt-team">{r.team_name}</td>
                  <td className="mono">{r.played}</td>
                  <td className="mono">{r.gf - r.ga > 0 ? '+' : ''}{r.gf - r.ga}</td>
                  <td className="mono lt-pts">{r.pts}</td>
                  <td className="mono lt-form">{r.won}-{r.drawn}-{r.lost}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {isAdmin && (
        <LeagueTableEdit
          open={editing} onClose={() => setEditing(false)} onSaved={onSaved}
          competition={competitions.find((c) => c.id === competitionId)} seasonId={seasonId}
          opponents={opponents} ourNames={[...ourNames]}
          rows={currentTable}
        />
      )}

      <style>{`
        .lt { width: 100%; border-collapse: collapse; font-size: var(--type-sm); }
        .lt th { text-align: center; font-family: var(--font-mono); font-size: var(--type-xs); letter-spacing: .06em;
          text-transform: uppercase; color: var(--bone-dim); padding: var(--space-2) var(--space-1); border-bottom: 1px solid var(--line); }
        .lt td { text-align: center; padding: var(--space-3) var(--space-1); border-bottom: 1px solid var(--line); }
        .lt .lt-team { text-align: left; font-family: var(--font-body); }
        .lt-pts { font-weight: 700; }
        .lt-ours { background: var(--slate); }
        .lt-ours .lt-team { font-weight: 700; color: var(--bone); }
        .lt-form { color: var(--bone-mute); }
      `}</style>
    </div>
  )
}

function LeagueTableEdit({ open, onClose, onSaved, competition, seasonId, rows, opponents = [], ourNames = [] }) {
  const { profile } = useAuth()
  const [draft, setDraft] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setDraft(rows.length
      ? rows.map((r) => ({ ...r }))
      : [{ team_name: '', played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, pts: 0 }])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const patchRow = (i, changes) => setDraft((d) => d.map((row, idx) => (idx === i ? { ...row, ...changes } : row)))
  const addRow = () => setDraft((d) => [...d, { team_name: '', played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, pts: 0 }])
  const rmRow = (i) => setDraft((d) => d.filter((_, idx) => idx !== i))

  async function save() {
    if (!competition) { setError('Pick a competition first.'); return }
    setError(null); setBusy(true)
    try {
      // Replace this competition's rows wholesale — simplest correct approach.
      // If the delete fails we MUST stop: inserting on top doubles every row.
      const { error: dErr } = await supabase.from('league_tables').delete().eq('season_id', seasonId).eq('competition_id', competition.id)
      if (dErr) throw dErr
      const payload = draft
        .filter((r) => r.team_name.trim())
        .map((r) => ({
          club_id: profile.club_id, season_id: seasonId, competition_id: competition.id,
          // An edit to points or goals preserves the stored name on historical rows.
          team_name: r.storedName ?? r.team_name.trim(),
          played: +r.played || 0, won: +r.won || 0, drawn: +r.drawn || 0, lost: +r.lost || 0,
          gf: +r.gf || 0, ga: +r.ga || 0, pts: +r.pts || 0,
        }))
      if (payload.length) {
        const { error } = await supabase.from('league_tables').insert(payload)
        if (error) throw error
      }
      onSaved(); onClose()
    } catch (err) { setError(friendlyError(err, "Couldn't save the table. Try again.")) } finally { setBusy(false) }
  }

  const N = ['played', 'won', 'drawn', 'lost', 'gf', 'ga', 'pts']
  const LBL = { played: 'P', won: 'W', drawn: 'D', lost: 'L', gf: 'GF', ga: 'GA', pts: 'Pts' }

  return (
    <Sheet open={open} onClose={onClose}>
      <p className="kicker"><span className="kicker-rule">{competition?.name ?? 'TABLE'}</span></p>
      <h2 className="display mt-2" style={{ fontSize: 'var(--type-title)' }}>Edit the table</h2>

      {/* Pick from your saved opponents or your own team names, or free-type. */}
      <datalist id="lt-teamnames">
        {ourNames.map((n) => <option key={n} value={n} />)}
        {opponents.map((o) => <option key={o.id} value={o.name} />)}
      </datalist>

      <div className="col gap-2 mt-4">
        {draft.map((r, i) => (
          <div key={i} className="card lte-row" style={{ padding: 'var(--space-2)' }}>
            <div className="row gap-2">
              <input className="input grow" placeholder="Team name" list="lt-teamnames" value={r.team_name} onChange={(e) => patchRow(i, { team_name: e.target.value, storedName: undefined })} />
              <button type="button" className="btn btn-ghost" onClick={() => rmRow(i)} aria-label="Remove row">✕</button>
            </div>
            <div className="lte-nums mt-2">
              {N.map((k) => (
                <label key={k} className="lte-num">
                  <span className="mono">{LBL[k]}</span>
                  <input className="input" type="number" min="0" value={r[k]} onChange={(e) => patchRow(i, { [k]: e.target.value })} />
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button type="button" className="chip mt-3" onClick={addRow}>+ Add a team</button>
      {/* Right above the Save button so it's on screen on a phone with a long division. */}
      {error && <p className="field-error mt-3" role="alert">{error}</p>}
      <div className="sheet-actions">
        <button className="btn btn-primary btn-block" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save table'}
        </button>
      </div>

      <style>{`
        .lte-nums { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(4em, 100%), 1fr)); gap: var(--space-1); }
        .lte-num { display: flex; flex-direction: column; align-items: center; gap: var(--space-1); }
        .lte-num span { font-size: var(--type-xs); color: var(--bone-dim); }
        .lte-num .input { width: 100%; text-align: center; padding: var(--space-2) var(--space-1); font-family: var(--font-mono); font-size: var(--type-sm); }
      `}</style>
    </Sheet>
  )
}
