import { useState } from 'react'
import { useSquad } from '../hooks/useSquad'
import { squadByPosition, primaryPosition } from '../lib/squadList'
import { Stagger, StaggerItem } from './Stagger'
import SquadDepth from './SquadDepth'
import Loader from './Loader'

const initials = (p) => `${(p.first_name?.[0] ?? '')}${(p.last_name?.[0] ?? '')}`.toUpperCase()

// §4 — the squad. Two views: 4.1 list by position (with avatars), and 4.2 an
// FM-style depth chart (pitch + tap-a-position). Player-facing (Club tab), so it
// reads a PII-free roster via useSquad.
export default function SquadList() {
  const { players, loading } = useSquad()
  const [view, setView] = useState('list') // 'list' | 'depth'
  if (loading) return <Loader label="Naming the squad…" />

  const groups = squadByPosition(players)
  const total = groups.reduce((n, g) => n + g.players.length, 0)

  if (total === 0) {
    return (
      <div className="empty mt-4">
        <p className="empty-title">No squad yet</p>
        <p>Once the manager signs players off, they'll line up here by position.</p>
      </div>
    )
  }

  return (
    <div className="mt-4">
      <div className="row gap-2">
        <button className="chip" aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button>
        <button className="chip" aria-pressed={view === 'depth'} onClick={() => setView('depth')}>Depth chart</button>
      </div>

      {view === 'depth' ? <SquadDepth players={players} /> : (
        <SquadByPosition groups={groups} total={total} />
      )}
    </div>
  )
}

function SquadByPosition({ groups, total }) {
  return (
    <div className="mt-4">
      <p className="sq-total mono">{total} in the squad</p>

      {groups.map((g) => (
        <section key={g.key} className="mt-4">
          <p className="kicker"><span className="kicker-rule">{g.label}</span> <span className="sq-count mono">{g.players.length}</span></p>
          <Stagger className="col gap-2 mt-2">
            {g.players.map((p) => (
              <StaggerItem key={p.id} className="card sq-row">
                {p.photo_url
                  ? <img className="sq-av" src={p.photo_url} alt="" />
                  : <span className="sq-av mono">{initials(p)}</span>}
                <span className="sq-main">
                  <span className="sq-name">{p.first_name} {p.last_name}</span>
                  <span className="sq-teams">
                    {p.teamKeys?.includes('xl') && <span className="sq-dot xl" title="First Team" />}
                    {p.teamKeys?.includes('community') && <span className="sq-dot co" title="Community" />}
                  </span>
                </span>
                {primaryPosition(p) && <span className="sq-pos mono">{primaryPosition(p)}</span>}
              </StaggerItem>
            ))}
          </Stagger>
        </section>
      ))}

      <style>{`
        .sq-total { font-size: 12px; color: var(--bone-mute); letter-spacing: .04em; text-transform: uppercase; }
        .sq-count { color: var(--bone-mute); font-size: 12px; margin-left: 6px; }
        .sq-row { display: flex; align-items: center; gap: 12px; padding: 10px 14px; }
        .sq-av { width: 40px; height: 40px; border-radius: 50%; flex: none; object-fit: cover;
          display: grid; place-items: center; background: var(--slate); border: 1px solid var(--line-2);
          font-size: 13px; font-weight: 600; color: var(--bone-mute); }
        .sq-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; }
        .sq-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sq-teams { display: flex; gap: 4px; flex: none; }
        .sq-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
        .sq-dot.xl { background: var(--red); }
        .sq-dot.co { background: var(--green); }
        .sq-pos { flex: none; font-size: 12px; font-weight: 600; color: var(--bone-mute);
          background: var(--slate); border: 1px solid var(--line); border-radius: 6px; padding: 3px 8px; }
      `}</style>
    </div>
  )
}
