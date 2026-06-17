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
  const accent = scope === 'community' ? 'var(--green)' : scope === 'xl' ? 'var(--red)' : 'var(--bone)'

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
            <GoldenBootIcon className="gb-boot" />
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
                <p className="kicker"><span className="kicker-rule" style={{ background: accent }}>{m.label.toUpperCase()}</span></p>
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
          <p className="kicker mt-5"><span className="kicker-rule" style={{ background: accent }}>THE SQUAD</span></p>
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
        .gb-boot { width: 46px; height: 46px; flex: none; }
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

// The Golden Boot award — a football boot emblem. Drawn dark (to read on the
// gold card) with a gold lace detail, toe pointing right with studs beneath.
function GoldenBootIcon(props) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* boot upper + foot */}
      <path d="M15 21 C14 15 18 12 24 13 C27 13.5 28 16 28 20 C28 27 33 33 44 34
               C51 34.5 55 36 56 39 C56.5 40.5 55.5 42 53 42 L17 42
               C12 42 11 37 11.5 31 C12 26 13 23 15 21 Z" fill="#3a2c05" />
      {/* sole */}
      <path d="M9 41.5 H56 a3 3 0 0 1 3 3 v0.5 a3 3 0 0 1 -3 3 H9 a3 3 0 0 1 -3 -3 V44.5 a3 3 0 0 1 3 -3 Z" fill="#2a2000" />
      {/* studs */}
      <g fill="#2a2000">
        <path d="M15 49 h5 v2.5 a2.5 2.5 0 0 1 -5 0 Z" />
        <path d="M27 49 h5 v2.5 a2.5 2.5 0 0 1 -5 0 Z" />
        <path d="M39 49 h5 v2.5 a2.5 2.5 0 0 1 -5 0 Z" />
        <path d="M49 49 h4 v2 a2 2 0 0 1 -4 0 Z" />
      </g>
      {/* laces (gold) */}
      <g stroke="#E8B53F" strokeWidth="2" strokeLinecap="round">
        <path d="M24 19 l4 1.6" /><path d="M25 23 l4 1.6" /><path d="M26.5 27 l4 1.6" />
      </g>
    </svg>
  )
}
