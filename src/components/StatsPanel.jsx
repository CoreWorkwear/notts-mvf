import { useMemo, useState } from 'react'
import { statRows, goldenBoot, leaders } from '../lib/stats'

const SCOPES = [
  { key: 'whole', label: 'Whole Club' },
  { key: 'xl', label: 'First Team' },
  { key: 'community', label: 'Community' },
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
  // Accent for the scope: Community green, otherwise the brand red (First Team and
  // the "All" default both use red — never bone, which rendered headers white).
  const accent = scope === 'community' ? 'var(--green)' : 'var(--red)'

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
          <p className="empty-title">No stats to argue over yet</p>
          <p>Golden boot, top scorers, the lot — it fills in once results start landing.</p>
        </div>
      ) : (
        <>
          {/* Golden Boot */}
          <div className="gb mt-4">
            <span className="gb-crown">👑</span>
            <div className="gb-body">
              <span className="kicker" style={{ color: '#3a2c05' }}>GOLDEN BOOT</span>
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
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Tap a heading to sort. Each figure: total, with league · friendly beneath.</p>
          <table className="st mt-2">
            <thead>
              <tr>
                <th className="st-name">Player</th>
                {METRICS.map((m) => (
                  <th key={m.key} className={'st-h' + (sortKey === m.key ? ' on' : '')} onClick={() => setSortKey(m.key)}>
                    {m.key === 'apps' ? 'Apps' : m.key === 'motm' ? 'MOTM' : m.key === 'assists' ? 'A' : 'G'}
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
          </table>
        </>
      )}

      <style>{`
        .fig { display: inline-flex; flex-direction: column; align-items: center; line-height: 1.1; }
        .fig-total { font-size: 16px; font-weight: 600; }
        .fig-split { font-size: 9px; color: var(--bone-dim); }
        .gb { display: flex; align-items: center; gap: 14px; padding: 16px;
          border-radius: var(--r-hero); color: #2a2000;
          background-image: linear-gradient(150deg, #F2CB5B 0%, #C9962a 100%);
          box-shadow: 0 14px 34px -18px rgba(201,150,42,.9); }
        .gb-crown { font-size: 30px; }
        .gb-body { flex: 1; min-width: 0; }
        .gb-name { font-family: var(--font-display); font-weight: 700; font-size: 22px; line-height: 1; margin-top: 4px;
          overflow: hidden; text-overflow: ellipsis; }
        .gb-num { font-size: 40px; font-weight: 700; }
        .lb-row { display: grid; grid-template-columns: 1fr 90px auto; align-items: center; gap: 10px; }
        .lb-name { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lb-bar { height: 8px; border-radius: 99px; background: var(--slate); overflow: hidden; }
        .lb-bar span { display: block; height: 100%; border-radius: 99px; transition: width var(--t-med); }
        .st { width: 100%; border-collapse: collapse; }
        .st th { padding: 8px 4px; border-bottom: 1px solid var(--line); font-family: var(--font-mono);
          font-size: 11px; color: var(--bone-dim); text-transform: uppercase; cursor: pointer; }
        .st th.st-name { text-align: left; cursor: default; }
        .st th.on { color: var(--bone); }
        .st td { padding: 10px 4px; border-bottom: 1px solid var(--line); text-align: center; }
        .st td.st-name { text-align: left; font-size: 14px; }
      `}</style>
    </div>
  )
}