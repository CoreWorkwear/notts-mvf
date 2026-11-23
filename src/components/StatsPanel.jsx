import { useId, useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { IconCompetitions } from './Icons'
import Segmented from './Segmented'
import SnapRail from './SnapRail'
import { TEAMS, TEAM_ORDER } from '../lib/constants'
import { SPRING_SNAPPY } from '../lib/motion'
import { statRows, goldenBoot, leaders } from '../lib/stats'
import '../styles/stats.css'

const SCOPES = [
  { key: 'whole', label: 'Whole Club' },
  ...TEAM_ORDER.map(key => ({ ...TEAMS[key], accent: key })),
]
const METRICS = [
  { key: 'goals', label: 'Goals', board: 'Top scorers' },
  { key: 'assists', label: 'Assists', board: 'Assists' },
  { key: 'apps', label: 'Apps', board: 'Appearances' },
  { key: 'motm', label: 'MOTM', board: 'Man of the match' },
]

function StatSplit({ cell }) {
  return <>
    <span aria-hidden="true">{cell.l}L · {cell.f}F</span>
    <span className="sr-only">{cell.l} league, {cell.f} friendly</span>
  </>
}

function Leaderboard({ metric, rows, boot }) {
  const reduce = useReducedMotion()
  const top = leaders(rows, metric.key, 5)
  if (!top.length) return null
  const max = top[0][metric.key].total
  const chasing = boot ? top.filter(player => player.goals.total < boot.goals) : top
  return (
    <section className={boot ? 'leader-card scoring-leaders' : 'leader-card'} aria-label={metric.board}>
      {boot ? <section className="boot-award" aria-label="Golden Boot">
        <h3><IconCompetitions aria-hidden="true" />Golden Boot</h3>
        <p className="boot-winners">{boot.top.map(p => p.name).join(' & ')}</p>
        <p className="boot-score"><strong className="mono">{boot.goals}</strong>
          {boot.goals === 1 ? 'goal' : 'goals'}{boot.top.length > 1 ? ' each' : ''}</p>
      </section> : <h3>{metric.board}</h3>}
      {chasing.length > 0 && <ol aria-label={boot ? 'Next scorers' : undefined}>
        {chasing.map(player => {
          const cell = player[metric.key]
          return <li key={player.id}>
            <div className="leader-line"><span>{player.name}</span><strong className="mono">{cell.total}</strong></div>
            <div className="leader-track" aria-hidden="true">
              <motion.span initial={reduce ? false : { scaleX: 0 }}
                animate={{ scaleX: cell.total / max }} transition={reduce ? { duration: 0 } : SPRING_SNAPPY} />
            </div>
          </li>
        })}
      </ol>}
    </section>
  )
}

export default function StatsPanel({ stats }) {
  const id = useId()
  const [scope, setScope] = useState('whole')
  const [sortKey, setSortKey] = useState('goals')
  const rows = useMemo(() => statRows(stats, scope), [stats, scope])
  const boot = useMemo(() => goldenBoot(rows), [rows])
  const squad = useMemo(
    () => [...rows].sort((a, b) => b[sortKey].total - a[sortKey].total || a.name.localeCompare(b.name)),
    [rows, sortKey]
  )

  return (
    <div className="club-stats" data-team={scope}>
      <Segmented options={SCOPES} value={scope} onChange={setScope} id={id} label="Statistics by team" />
      {!rows.length ? <div className="empty mt-5"><p className="empty-title">No stats yet</p></div> : <>
        <section className="stats-section">
          <h2>Leaderboards</h2>
          <SnapRail className="leader-cards" label="Player leaderboards">
            {METRICS.filter(metric => rows.some(p => p[metric.key].total)).map(metric =>
              <Leaderboard key={metric.key} metric={metric} rows={rows} boot={metric.key === 'goals' ? boot : null} />
            )}
          </SnapRail>
        </section>

        <section className="stats-section">
          <header className="squad-stats-head">
            <h2>Squad statistics</h2>
            <label>Sort by <select className="select" aria-label="Sort squad by" value={sortKey}
              onChange={event => setSortKey(event.target.value)}>
              {METRICS.map(m => <option key={m.key} value={m.key}>{m.key === 'apps' ? 'Appearances' : m.label}</option>)}
            </select></label>
          </header>
          <p className="stats-key">L · League <span>F · Friendly</span></p>
          <ol className="squad-stats" aria-label="Squad statistics">
            {squad.map(p => <li key={p.id}>
              <h3>{p.name}</h3>
              <dl>
                {METRICS.map(m => <div key={m.key} data-selected={sortKey === m.key}>
                  <dt>{m.label}</dt>
                  <dd><strong className="mono">{p[m.key].total}</strong>
                    {p[m.key].total > 0 && <small><StatSplit cell={p[m.key]} /></small>}
                  </dd>
                </div>)}
              </dl>
            </li>)}
          </ol>
        </section>
      </>}
    </div>
  )
}
