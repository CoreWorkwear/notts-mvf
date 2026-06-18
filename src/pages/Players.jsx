import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { usePlayers } from '../hooks/usePlayers'
import PlayerForm from '../components/PlayerForm'
import Loader from '../components/Loader'

export default function Players() {
  const { user } = useAuth()
  const { players, loading, refetch } = usePlayers()
  const [teams, setTeams] = useState([])
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null) // player or null
  const [formOpen, setFormOpen] = useState(false)

  useEffect(() => {
    supabase.from('teams').select('id, key, label, is_first_team')
      .then(({ data }) => setTeams((data ?? []).sort((a, b) => Number(b.is_first_team) - Number(a.is_first_team))))
  }, [])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return players
    return players.filter((p) => `${p.first_name} ${p.last_name}`.toLowerCase().includes(needle))
  }, [players, q])

  // Sign-off queue first, then the squad, supporters, and removed players.
  const pendingList = filtered.filter((p) => p.active && p.is_player && !p.approved)
  const squadList = filtered.filter((p) => p.active && p.is_player && p.approved)
  const supporterList = filtered.filter((p) => p.active && !p.is_player)
  const inactiveList = filtered.filter((p) => !p.active)

  const openAdd = () => { setEditing(null); setFormOpen(true) }
  const openEdit = (p) => { setEditing(p); setFormOpen(true) }

  // One-tap manager sign-off. RLS lets an admin set approved; the protect trigger
  // blocks everyone else.
  async function approve(id) {
    const { error } = await supabase.from('profiles').update({ approved: true }).eq('id', id)
    if (error) { alert(error.message); return }
    refetch()
  }

  if (loading) return <Loader label="Pulling the squad…" />

  return (
    <div className="page">
      <p className="kicker"><span className="kicker-rule">THE SQUAD</span></p>
      <h1 className="display mt-2" style={{ fontSize: 28 }}>Players</h1>

      <input className="input mt-3" placeholder="Search players…" value={q} onChange={(e) => setQ(e.target.value)} />
      <button className="btn btn-primary btn-block mt-3" onClick={openAdd}>+ Add a player</button>

      {pendingList.length > 0 && (
        <Section title={`Awaiting sign-off · ${pendingList.length}`} list={pendingList} onEdit={openEdit} onApprove={approve} meId={user?.id} accent />
      )}
      <Section title={`Active · ${squadList.length}`} list={squadList} onEdit={openEdit} meId={user?.id} empty="No active players." />
      {supporterList.length > 0 && (
        <Section title={`Supporters · ${supporterList.length}`} list={supporterList} onEdit={openEdit} meId={user?.id} />
      )}
      {inactiveList.length > 0 && (
        <Section title={`Inactive · ${inactiveList.length}`} list={inactiveList} onEdit={openEdit} meId={user?.id} muted />
      )}

      <PlayerForm
        open={formOpen} onClose={() => setFormOpen(false)} onSaved={refetch}
        player={editing} teams={teams} currentUserId={user?.id}
      />
    </div>
  )
}

function Section({ title, list, onEdit, onApprove, meId, muted, empty, accent }) {
  return (
    <div className="mt-5">
      <p className="kicker" style={{ color: accent ? 'var(--amber)' : 'var(--bone-mute)' }}>{title}</p>
      {list.length === 0 ? (
        empty ? <p className="dim mt-2" style={{ fontSize: 14 }}>{empty}</p> : null
      ) : (
        <div className="col gap-2 mt-2 stagger">
          {list.map((p) => (
            <button key={p.id} className="card pl-row" onClick={() => onEdit(p)} style={muted ? { opacity: 0.7 } : {}}>
              {p.photo_url
                ? <img className="pl-av" src={p.photo_url} alt="" />
                : <span className="pl-av mono">{`${(p.first_name?.[0] ?? '')}${(p.last_name?.[0] ?? '')}`.toUpperCase()}</span>}
              <span className="pl-main">
                <span className="pl-name">{p.first_name} {p.last_name}{p.id === meId ? ' · you' : ''}</span>
                <span className="pl-tags">
                  {!p.is_player && <span className="tag tag-supporter">Supporter</span>}
                  {p.is_player && !p.approved && <span className="tag tag-pending">Pending</span>}
                  {p.teamKeys.includes('xl') && <span className="tag tag-xl">First Team</span>}
                  {p.teamKeys.includes('community') && <span className="tag tag-co">Community</span>}
                  {p.role === 'admin' && <span className="tag tag-admin">Manager</span>}
                </span>
              </span>
              {onApprove && (
                <span role="button" tabIndex={0} className="pl-approve"
                  onClick={(e) => { e.stopPropagation(); onApprove(p.id) }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onApprove(p.id) } }}>
                  Sign off
                </span>
              )}
              <span className="pl-go">›</span>
            </button>
          ))}
        </div>
      )}

      <style>{`
        .pl-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: var(--coal);
          color: var(--bone); border: 1px solid var(--line); text-align: left; }
        .pl-av { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center;
          background: var(--slate); border: 1px solid var(--line-2); font-size: 13px; font-weight: 600; flex: none;
          object-fit: cover; }
        .pl-main { flex: 1; min-width: 0; }
        .pl-name { display: block; font-weight: 600; }
        .pl-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
        .tag { font-size: 10px; letter-spacing: .04em; text-transform: uppercase; padding: 2px 7px;
          border-radius: 6px; background: var(--slate); color: var(--bone-mute); border: 1px solid var(--line); }
        .tag-xl { color: var(--red-bright); border-color: var(--red); }
        .tag-co { color: var(--green-bright); border-color: var(--green); }
        .tag-admin { color: var(--gold); border-color: var(--gold); }
        .tag-pending { color: var(--amber); border-color: var(--amber); }
        .tag-supporter { color: var(--bone-mute); border-color: var(--line-2); }
        .pl-approve { flex: none; font-size: 12px; font-weight: 600; color: var(--green-bright);
          border: 1px solid var(--green); background: var(--green-dim-2); border-radius: 8px; padding: 6px 10px; }
        .pl-go { color: var(--bone-dim); font-size: 20px; }
      `}</style>
    </div>
  )
}
