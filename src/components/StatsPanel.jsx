import { useMemo, useState } from 'react'
import { IconCompetitions } from './Icons'
import { TEAMS, TEAM_ORDER } from '../lib/constants'
import { statRows, goldenBoot, leaders } from '../lib/stats'

const SCOPES = [
  { key: 'whole', label: 'Whole Club' },
  ...TEAM_ORDER.map((key) => TEAMS[key]),
]
const METRICS = [
  { key: 'goals', label: 'Top scorers' },
  { key: 'assists', label: 'Assists' },
  { key: 'apps', label: 'Appearances' },
  { key: 'motm', label: 'MOTM' },
]

// Combined headline with the league/friendly split beneath (e.g. "3" / "2L · 1F").
function Figure({ cell }) {
  return (
    <span className="fig">
      <span className="fig-total mono">{cell.total}</span>
      {cell.total > 0 && <span className="fig-split mono">{cell.l}L · {cell.f}F</span>}
    </span>
  )
}

export default function StatsPanel({ stats }) {
  const [scope, setScope] = useState('whole')
  const [sortKey, setSortKey] = useState('goals')
  const rows = useMemo(() => statRows(stats, scope), [stats, scope])
  const boot = useMemo(() => goldenBoot(rows), [rows])
  const accent = scope === 'community' ? 'var(--team-community)' : scope === 'xl' ? 'var(--team-xl)' : 'var(--text)'

  const squad = useMemo(
    () => [...rows].sort((a, b) => b[sortKey].total - a[sortKey].total || a.name.localeCompare(b.name)),
    [rows, sortKey]
  )

  return (
    <div className="mt-4">
      <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
        {SCOPES.map((s) => (
          <button key={s.key} className={'chip' + (s.key === 'community' ? ' community' : '')}
            aria-pressed={scope === s.key} onClick={() => setScope(s.key)}>{s.label}</button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="empty mt-5">
          <p className="empty-title">No stats yet</p>
        </div>
      ) : (
        <>
          {/* Golden Boot */}
          <div className="gb mt-4">
            <IconCompetitions className="gb-trophy" aria-hidden="true" />
            <div className="gb-body">
              <span className="kicker" style={{ color: 'var(--award)' }}>GOLDEN BOOT</span>
              <div className="gb-name">{boot.top.length ? boot.top.map((p) => p.name).join(' & ') : '—'}</div>
            </div>
            <span className="gb-num mono">{boot.goals}</span>
          </div>

          {/* Leaderboards as bars */}
          {METRICS.map((m) => {
            const top = leaders(rows, m.key, 5)
            if (top.length === 0) return null
            const max = top[0][m.key].total
            return (
              <div key={m.key} className="lb mt-5">
                <p className="kicker"><span className="kicker-rule" style={{ borderColor: accent }}>{m.label.toUpperCase()}</span></p>
                <div className="col gap-2 mt-3">
                  {top.map((p) => (
                    <div key={p.id} className="lb-row">
                      <span className="lb-name">{p.name}</span>
                      <div className="lb-bar"><span style={{ width: `${(p[m.key].total / max) * 100}%`, background: accent }} /></div>
                      <Figure cell={p[m.key]} />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          {/* Full squad table */}
          <p className="kicker mt-5"><span className="kicker-rule" style={{ borderColor: accent }}>THE SQUAD</span></p>
          <div className="table-scroll"><table className="st mt-2">
            <thead>
              <tr>
                <th className="st-name">Player</th>
                {METRICS.map((m) => (
                  <th key={m.key} className={'st-h' + (sortKey === m.key ? ' on' : '')} aria-sort={sortKey === m.key ? 'descending' : undefined}>
                    <button type="button" aria-label={'Sort by ' + m.label.toLowerCase()} onClick={() => setSortKey(m.key)}>{m.key === 'apps' ? 'Apps' : m.key === 'motm' ? 'MOTM' : m.key === 'assists' ? 'A' : 'G'}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {squad.map((p) => (
                <tr key={p.id}>
                  <td className="st-name">{p.name}</td>
                  <td><Figure cell={p.goals} /></td>
                  <td><Figure cell={p.assists} /></td>
                  <td><Figure cell={p.apps} /></td>
                  <td><Figure cell={p.motm} /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}

      <style>{`
        .fig { display: inline-flex; flex-direction: column; align-items: center; line-height: 1.1; }
        .fig-total { font-size: var(--type-body); font-weight: 600; }
        .fig-split { font-size: var(--type-xs); color: var(--bone-dim); }
        .gb { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-4);
          border: 1px solid var(--border); border-radius: var(--r-card); color: var(--text); background: var(--surface-raised); }
        .gb-trophy { color: var(--award); flex: none; }
        .gb-body { flex: 1; min-width: 0; }
        .gb-name { font-family: var(--font-display); font-weight: 700; font-size: var(--type-title); line-height: 1; margin-top: var(--space-1);
          overflow: hidden; text-overflow: ellipsis; }
        .gb-num { font-size: var(--type-score); font-weight: 700; }
        .lb-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(32px, 26%) auto; align-items: center; gap: var(--space-2); }
        .lb-name { font-size: var(--type-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lb-bar { height: 8px; border-radius: var(--r-input); background: var(--slate); overflow: hidden; }
        .lb-bar span { display: block; height: 100%; border-radius: inherit; transition: width var(--t-med); }
        .st { width: 100%; border-collapse: collapse; }
        .st th { padding: var(--space-2) var(--space-1); border-bottom: 1px solid var(--line); font-family: var(--font-mono);
          font-size: var(--type-xs); color: var(--bone-dim); text-transform: uppercase; cursor: pointer; }
        .st th button { width: 100%; min-height: var(--target); min-width: var(--target); font: inherit; color: inherit; background: none; border: none; }
        .st th.st-name { font-family: var(--font-body); text-align: left; cursor: default; }
        .st th.on { color: var(--bone); }
        .st td { padding: var(--space-2) var(--space-1); border-bottom: 1px solid var(--line); text-align: center; }
        .st td.st-name { text-align: left; font-size: var(--type-sm); }
      `}</style>
    </div>
  )
}