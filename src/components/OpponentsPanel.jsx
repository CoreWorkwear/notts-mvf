import LoadIssue from './LoadIssue'
import ClubImage from './ClubImage'
import { useMemo, useState } from 'react'
import { useOpponents } from '../hooks/useOpponents'
import OpponentForm from './OpponentForm'
import Loader from './Loader'

// Admin opponents CRUD (BUILD-LIST A2). League teams (with badges) and one-off
// friendly sides live together; persist across seasons.
export default function OpponentsPanel() {
  const { opponents, loading, save, error, refetch } = useOpponents()
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(false)

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase()
    return n ? opponents.filter((o) => o.name.toLowerCase().includes(n)) : opponents
  }, [opponents, q])

  const openAdd = () => { setEditing(null); setOpen(true) }
  const openEdit = (o) => { setEditing(o); setOpen(true) }

  if (loading && !opponents.length && !open) return <Loader label="Loading opponents…" />

  if (error && !opponents.length && !open) return <LoadIssue subject="the opponents" retry={refetch} />
  return (
    <div className="mt-4">
      {error && <LoadIssue subject="the opponents" retry={refetch} stale />}
      <input className="input" placeholder="Search opponents…" aria-label="Search opponents" value={q} onChange={(e) => setQ(e.target.value)} />
      <button className="btn btn-primary btn-block mt-3" onClick={openAdd}>+ Add an opponent</button>

      {filtered.length === 0 ? (
        <div className="empty mt-5">
          <p className="empty-title">{q.trim() ? 'No matching opponents' : 'No opponents yet'}</p>
        </div>
      ) : (
        <div className="col gap-2 mt-4">
          {filtered.map((o) => (
            <div key={o.id}>
              <button className="card opp-row" style={{ width: '100%' }} onClick={() => openEdit(o)}>
                {o.badge_url
                  ? <ClubImage sizes="40px" className="opp-badge" src={o.badge_url} alt="" />
                  : <span className="opp-badge opp-mono">{(o.name?.[0] ?? '?').toUpperCase()}</span>}
                <span className="opp-main">
                  <span className="opp-name">{o.name}</span>
                  <span className="opp-tags">
                    {o.is_league_team && <span className="tag tag-league">League</span>}
                    {o.home_venue && <span className="opp-venue">{o.home_venue}</span>}
                  </span>
                </span>
                <span className="opp-go">›</span>
              </button>
            </div>
          ))}
        </div>
      )}

      <OpponentForm open={open} opponent={editing} onClose={() => setOpen(false)} onSave={save} />

      <style>{`
        .opp-row { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-3); background: var(--coal);
          color: var(--bone); border: 1px solid var(--line); text-align: left; }
        .opp-badge { width: 38px; height: 38px; border-radius: 50%; flex: none; object-fit: cover;
          background: var(--slate); border: 1px solid var(--line-2); display: grid; place-items: center; }
        .opp-mono { font-weight: 700; color: var(--bone-mute); }
        .opp-main { flex: 1; min-width: 0; }
        .opp-name { display: block; font-weight: 600; }
        .opp-tags { display: flex; gap: var(--space-2); align-items: center; margin-top: var(--space-1); }
        .opp-venue { font-size: var(--type-caption); color: var(--bone-mute); }
        .tag-league { font-size: var(--type-xs); letter-spacing: .04em; text-transform: uppercase; padding: var(--space-1) var(--space-2);
          border-radius: 6px; background: var(--slate); color: var(--bone-mute); border: 1px solid var(--line); }
        .opp-go { color: var(--bone-dim); font-size: var(--type-lg); }
      `}</style>
    </div>
  )
}
