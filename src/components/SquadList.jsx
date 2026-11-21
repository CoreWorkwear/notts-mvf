import LoadIssue from './LoadIssue'
import ClubImage from './ClubImage'
import { useState } from 'react'
import { useSquad } from '../hooks/useSquad'
import { squadByPosition, primaryPosition } from '../lib/squadList'
import { TEAMS, TEAM_ORDER } from '../lib/constants'
import SquadDepth from './SquadDepth'
import Loader from './Loader'

const initials = (p) => `${(p.first_name?.[0] ?? '')}${(p.last_name?.[0] ?? '')}`.toUpperCase()

// §4 — the squad. Two views: 4.1 list by position (with avatars), and 4.2 an
// FM-style depth chart (pitch + tap-a-position), each filterable by team via the
// red/green toggle. Player-facing (Club tab), so it reads a PII-free roster.
export default function SquadList() {
  const { players, loading, error, refetch } = useSquad()
  const [view, setView] = useState('list') // 'list' | 'depth'
  const [team, setTeam] = useState('all')  // 'all' | 'xl' | 'community'
  if (loading && !players.length) return <Loader label="Loading the squad…" />

  const filtered = team === 'all' ? players : players.filter((p) => p.teamKeys?.includes(team))
  const groups = squadByPosition(filtered)
  const total = groups.reduce((n, g) => n + g.players.length, 0)

  if (error && !players.length) return <LoadIssue subject="the squad" retry={refetch} />
  return (
    <div className="mt-4">
      {error && <LoadIssue subject="the squad" retry={refetch} stale />}
      {/* View selector (parent) on top; team filter (red/green) below it. */}
      <div className="sq-seg" role="tablist" aria-label="Squad view">
        <button className={'sq-seg-btn' + (view === 'list' ? ' on' : '')} role="tab" aria-selected={view === 'list'} onClick={() => setView('list')}>List</button>
        <button className={'sq-seg-btn' + (view === 'depth' ? ' on' : '')} role="tab" aria-selected={view === 'depth'} onClick={() => setView('depth')}>Depth chart</button>
      </div>
      <div className="row gap-2 mt-2" style={{ flexWrap: 'wrap' }}>
        <button className="chip" aria-pressed={team === 'all'} onClick={() => setTeam('all')}>All</button>
        {TEAM_ORDER.map((k) => (
          <button key={k} className={'chip' + (k === 'community' ? ' community' : '')} aria-pressed={team === k} onClick={() => setTeam(k)}>{TEAMS[k].label}</button>
        ))}
      </div>

      {total === 0 ? (
        <div className="empty mt-4">
          <p className="empty-title">No squad yet</p>
        </div>
      ) : view === 'depth' ? <SquadDepth players={filtered} /> : (
        <SquadByPosition groups={groups} total={total} />
      )}

      <style>{`
        .sq-seg { display: flex; gap: var(--space-1); padding: var(--space-1); background: var(--slate); border: 1px solid var(--line);
          border-radius: var(--r-card); }
        .sq-seg-btn { flex: 1; padding: var(--space-2) var(--space-2); border: none; background: none; color: var(--bone-mute);
          font-family: var(--font-body); font-size: var(--type-sm); font-weight: 600; min-height: var(--target); border-radius: var(--r-input); transition: background var(--t-fast); }
        .sq-seg-btn.on { background: var(--action-fill); color: var(--on-action); }
      `}</style>
    </div>
  )
}

function SquadByPosition({ groups, total }) {
  return (
    <div className="mt-4">
      <p className="sq-total"><span className="mono">{total}</span> in the squad</p>

      {groups.map((g) => (
        <section key={g.key} className="mt-4">
          <p className="kicker"><span className="kicker-rule">{g.label}</span> <span className="sq-count mono">{g.players.length}</span></p>
          <div className="col gap-2 mt-2">
            {g.players.map((p) => (
              <div key={p.id} className="card sq-row">
                {p.photo_url
                  ? <ClubImage sizes="40px" className="sq-av" src={p.photo_url} alt="" />
                  : <span className="sq-av mono">{initials(p)}</span>}
                <span className="sq-main">
                  <span className="sq-name">{p.first_name} {p.last_name}</span>
                  <span className="sq-teams">
                    {TEAM_ORDER.filter(key => p.teamKeys?.includes(key)).map(key =>
                      <span key={key} className={'sq-team ' + key}>{TEAMS[key].label}</span>)}
                  </span>
                </span>
                {primaryPosition(p) && <span className="sq-pos mono">{primaryPosition(p)}</span>}
              </div>
            ))}
          </div>
        </section>
      ))}

      <style>{`
        .sq-total { font-size: var(--type-caption); color: var(--bone-mute); letter-spacing: .04em; text-transform: uppercase; }
        .sq-count { color: var(--bone-mute); font-size: var(--type-caption); margin-left: var(--space-1); }
        .sq-row { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-3); }
        .sq-av { width: 40px; height: 40px; border-radius: 50%; flex: none; object-fit: cover;
          display: grid; place-items: center; background: var(--slate); border: 1px solid var(--line-2);
          font-size: var(--type-sm); font-weight: 600; color: var(--bone-mute); }
        .sq-main { flex: 1; min-width: 0; display: grid; gap: var(--space-1); }
        .sq-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
         .sq-teams { display: flex; flex-wrap: wrap; gap: var(--space-2); font-size: var(--type-xs); }
        .sq-team.xl { color: var(--team-xl); }
        .sq-team.community { color: var(--team-community); }
        .sq-pos { flex: none; font-size: var(--type-caption); font-weight: 600; color: var(--bone-mute);
          background: var(--slate); border: 1px solid var(--line); border-radius: var(--r-input); padding: var(--space-1) var(--space-2); }
      `}</style>
    </div>
  )
}
