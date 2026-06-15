import { useMemo, useState } from 'react'
import { useOpponents } from '../hooks/useOpponents'
import OpponentForm from './OpponentForm'
import Loader from './Loader'

// Admin opponents CRUD (BUILD-LIST A2). League teams (with badges) and one-off
// friendly sides live together; persist across seasons.
export default function OpponentsPanel() {
  const { opponents, loading, save } = useOpponents()
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(false)

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase()
    return n ? opponents.filter((o) => o.name.toLowerCase().includes(n)) : opponents
  }, [opponents, q])

  const openAdd = () => { setEditing(null); setOpen(true) }
  const openEdit = (o) => { setEditing(o); setOpen(true) }

  if (loading) return <Loader label="Loading opponents…" />

  return (
    <div className="mt-4">
      <input className="input" placeholder="Search opponents…" value={q} onChange={(e) => setQ(e.target.value)} />
      <button className="btn btn-primary btn-block mt-3" onClick={openAdd}>+ Add an opponent</button>

      {filtered.length === 0 ? (
        <div className="empty mt-5">
          <p className="empty-title">No opponents yet</p>
          <p>Add the teams in your league (with badges), or a quick name for a one-off friendly.</p>
        </div>
      ) : (
        <div className="col gap-2 mt-4 stagger">
          {filtered.map((o) => (
            <button key={o.id} className="card opp-row" onClick={() => openEdit(o)}>
              {o.badge_url
                ? <img className="opp-badge" src={o.badge_url} alt="" />
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
          ))}
        </div>
      )}

      <OpponentForm open={open} opponent={editing} onClose={() => setOpen(false)} onSave={save} />

      <style>{`
        .opp-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: var(--coal);
          color: var(--bone); border: 1px solid var(--line); text-align: left; }
        .opp-badge { width: 38px; height: 38px; border-radius: 50%; flex: none; object-fit: cover;
          background: var(--slate); border: 1px solid var(--line-2); display: grid; place-items: center; }
        .opp-mono { font-weight: 700; color: var(--bone-mute); }
        .opp-main { flex: 1; min-width: 0; }
        .opp-name { display: block; font-weight: 600; }
        .opp-tags { display: flex; gap: 8px; align-items: center; margin-top: 3px; }
        .opp-venue { font-size: 12px; color: var(--bone-mute); }
        .tag-league { font-size: 10px; letter-spacing: .04em; text-transform: uppercase; padding: 2px 7px;
          border-radius: 6px; background: var(--slate); color: var(--bone-mute); border: 1px solid var(--line); }
        .opp-go { color: var(--bone-dim); font-size: 20px; }
      `}</style>
    </div>
  )
}
