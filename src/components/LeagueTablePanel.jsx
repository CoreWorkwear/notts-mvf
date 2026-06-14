import { useEffect, useState } from 'react'
import Sheet from './Sheet'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { sortStandings } from '../lib/stats'

// Manual league table, per team / per season (HANDOVER §5). View shows pos,
// team, P, GD, Pts, W-D-L with our row highlighted. Admin edits the grid; we
// re-sort by pts → GD → GF on display.
export default function LeagueTablePanel({ table, teams, seasonId, onSaved }) {
  const { isAdmin } = useAuth()
  const [teamKey, setTeamKey] = useState(teams[0]?.key ?? 'xl')
  const [editing, setEditing] = useState(false)

  const team = teams.find((t) => t.key === teamKey) ?? teams[0]
  const rows = sortStandings(table.filter((r) => r.team_id === team?.id))

  return (
    <div className="mt-4">
      {teams.length > 1 && (
        <div className="row gap-2">
          {teams.map((t) => (
            <button key={t.id} className={'chip' + (t.key === 'community' ? ' community' : '')}
              aria-pressed={teamKey === t.key} onClick={() => setTeamKey(t.key)}>{t.label}</button>
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
          <p className="empty-title">Table's empty</p>
          <p>{isAdmin ? 'Pop the division in from the league site — it stays manual.' : "The manager keeps this current from the league's own source."}</p>
        </div>
      ) : (
        <table className="lt mt-3">
          <thead>
            <tr><th>#</th><th className="lt-team">Team</th><th>P</th><th>GD</th><th>Pts</th><th className="lt-form">W-D-L</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const ours = r.team_name === team?.label
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
          team={team} seasonId={seasonId}
          rows={table.filter((r) => r.team_id === team?.id)}
        />
      )}

      <style>{`
        .lt { width: 100%; border-collapse: collapse; font-size: 14px; }
        .lt th { text-align: center; font-family: var(--font-mono); font-size: 10px; letter-spacing: .06em;
          text-transform: uppercase; color: var(--bone-dim); padding: 8px 6px; border-bottom: 1px solid var(--line); }
        .lt td { text-align: center; padding: 11px 6px; border-bottom: 1px solid var(--line); }
        .lt .lt-team { text-align: left; font-family: var(--font-body); }
        .lt-pts { font-weight: 700; }
        .lt-ours { background: var(--slate); }
        .lt-ours .lt-team { font-weight: 700; color: var(--bone); }
        .lt-form { color: var(--bone-mute); }
      `}</style>
    </div>
  )
}

function LeagueTableEdit({ open, onClose, onSaved, team, seasonId, rows }) {
  const { profile } = useAuth()
  const [draft, setDraft] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setDraft(rows.length
      ? rows.map((r) => ({ team_name: r.team_name, played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, gf: r.gf, ga: r.ga, pts: r.pts }))
      : [{ team_name: team?.label ?? '', played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, pts: 0 }])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const setCell = (i, k, v) => setDraft((d) => d.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)))
  const addRow = () => setDraft((d) => [...d, { team_name: '', played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, pts: 0 }])
  const rmRow = (i) => setDraft((d) => d.filter((_, idx) => idx !== i))

  async function save() {
    setError(null); setBusy(true)
    try {
      // Replace this division's rows wholesale — simplest correct approach.
      await supabase.from('league_tables').delete().eq('season_id', seasonId).eq('team_id', team.id)
      const payload = draft
        .filter((r) => r.team_name.trim())
        .map((r) => ({
          club_id: profile.club_id, season_id: seasonId, team_id: team.id,
          team_name: r.team_name.trim(),
          played: +r.played || 0, won: +r.won || 0, drawn: +r.drawn || 0, lost: +r.lost || 0,
          gf: +r.gf || 0, ga: +r.ga || 0, pts: +r.pts || 0,
        }))
      if (payload.length) {
        const { error } = await supabase.from('league_tables').insert(payload)
        if (error) throw error
      }
      onSaved(); onClose()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const N = ['played', 'won', 'drawn', 'lost', 'gf', 'ga', 'pts']
  const LBL = { played: 'P', won: 'W', drawn: 'D', lost: 'L', gf: 'GF', ga: 'GA', pts: 'Pts' }

  return (
    <Sheet open={open} onClose={onClose}>
      <p className="kicker"><span className="kicker-rule">{team?.label} TABLE</span></p>
      <h2 className="display mt-2" style={{ fontSize: 24 }}>Edit the table</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>Straight off the league's own site. GD sorts itself.</p>
      {error && <p className="field-error mt-3">{error}</p>}

      <div className="col gap-2 mt-4">
        {draft.map((r, i) => (
          <div key={i} className="card lte-row" style={{ padding: 10 }}>
            <div className="row gap-2">
              <input className="input grow" placeholder="Team name" value={r.team_name} onChange={(e) => setCell(i, 'team_name', e.target.value)} />
              <button type="button" className="btn btn-ghost" onClick={() => rmRow(i)} aria-label="Remove row">✕</button>
            </div>
            <div className="lte-nums mt-2">
              {N.map((k) => (
                <label key={k} className="lte-num">
                  <span className="mono">{LBL[k]}</span>
                  <input className="input" type="number" min="0" value={r[k]} onChange={(e) => setCell(i, k, e.target.value)} />
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button type="button" className="chip mt-3" onClick={addRow}>+ Add a team</button>
      <button className="btn btn-primary btn-block mt-3" disabled={busy} onClick={save}>
        {busy ? 'Saving…' : 'Save table'}
      </button>

      <style>{`
        .lte-nums { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
        .lte-num { display: flex; flex-direction: column; align-items: center; gap: 3px; }
        .lte-num span { font-size: 10px; color: var(--bone-dim); }
        .lte-num .input { width: 100%; text-align: center; padding: 8px 2px; font-family: var(--font-mono); font-size: 14px; }
      `}</style>
    </Sheet>
  )
}
