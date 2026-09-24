import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { logError } from '../lib/logger'
import { useAuth } from '../context/AuthContext'
import { usePlayers } from '../hooks/usePlayers'
import PlayerForm from '../components/PlayerForm'
import { Stagger, StaggerItem } from '../components/Stagger'
import Loader from '../components/Loader'
import Toast from '../components/Toast'

export default function Players() {
  const { user } = useAuth()
  const { players, loading, error, refetch } = usePlayers()
  const [teams, setTeams] = useState([])
  const [teamsError, setTeamsError] = useState(null)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null) // player or null
  const [formOpen, setFormOpen] = useState(false)
  const [toast, setToast] = useState(null)

  // The squads list drives PlayerForm's team chips AND the membership diff on
  // save. A failed fetch used to be swallowed (teams=[]), and a save then read
  // as "unticked everything" — the player was stripped from every squad. Now
  // the failure is kept, shown, and retryable; PlayerForm refuses to save
  // squad changes while it stands.
  const loadTeams = useCallback(async () => {
    setTeamsError(null)
    try {
      const { data, error: fetchErr } = await supabase.from('teams').select('id, key, label, is_first_team')
      if (fetchErr) throw fetchErr
      setTeams((data ?? []).sort((a, b) => Number(b.is_first_team) - Number(a.is_first_team)))
    } catch (e) {
      logError('fetch', e ?? 'teams load failed', { page: 'Players', op: 'teams' })
      setTeamsError(e ?? new Error('teams load failed'))
    }
  }, [])

  useEffect(() => { loadTeams() }, [loadTeams])

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
    if (error) { setToast("Couldn't sign them off — check your signal and give it another go."); return }
    refetch()
  }

  // Only the FIRST load gets the Loader: a refetch after a save flips loading
  // true too, and swapping the page out would unmount the open PlayerForm sheet.
  if (loading && players.length === 0) return <Loader label="Pulling the squad…" />

  // A failed first load is not an empty squad: say so and offer a retry.
  if (error && players.length === 0) return (
    <div className="page">
      <div className="empty mt-5" role="alert">
        <p className="empty-title">Couldn't pull the squad</p>
        <p>Looks like a dodgy connection. Have another go.</p>
        <button className="btn btn-primary mt-3" onClick={() => { refetch(); if (teamsError) loadTeams() }}>Try again</button>
      </div>
    </div>
  )

  return (
    <div className="page">
      <Toast message={toast} onDismiss={() => setToast(null)} />
      <p className="kicker"><span className="kicker-rule">THE SQUAD</span></p>
      <h1 className="display mt-2" style={{ fontSize: 28 }}>Players</h1>
      {error && <p className="dim mt-2" role="status" style={{ fontSize: 13 }}>Couldn't refresh just now — showing what we had.</p>}

      <input className="input mt-3" placeholder="Search players…" value={q} onChange={(e) => setQ(e.target.value)} />
      <button className="btn btn-primary btn-block mt-3" onClick={openAdd}>+ Add a player</button>

      {teamsError && teams.length === 0 && (
        <div className="card mt-3" role="alert" style={{ padding: 14, borderColor: 'var(--amber)' }}>
          <p style={{ fontWeight: 600 }}>Squads didn't load — try again.</p>
          <p className="dim mt-1" style={{ fontSize: 13 }}>Until they do, nobody's squads can be changed.</p>
          <button className="btn btn-ghost btn-block mt-2" onClick={loadTeams}>Try again</button>
        </div>
      )}

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
        <Stagger className="col gap-2 mt-2">
          {list.map((p) => (
            <StaggerItem key={p.id}>
            <button className="card pl-row" onClick={() => onEdit(p)} style={{ width: '100%', ...(muted ? { opacity: 0.7 } : {}) }}>
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
            </StaggerItem>
          ))}
        </Stagger>
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
        .tag { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; padding: 2px 8px;
          border-radius: 6px; background: var(--slate); color: var(--bone-mute); border: 1px solid var(--line); }
        .tag-xl { color: var(--red-bright); border-color: var(--red); }
        .tag-co { color: var(--green-bright); border-color: var(--green); }
        .tag-admin { color: var(--gold); border-color: var(--gold); }
        .tag-pending { color: var(--amber); border-color: var(--amber); }
        .tag-supporter { color: var(--bone-mute); border-color: var(--line-2); }
        /* Solid fill + dark text so the action is unmistakable (was bright-on-dim, ~1.6:1). */
        .pl-approve { flex: none; font-size: 13px; font-weight: 700; color: var(--ink);
          border: none; background: var(--green); border-radius: 8px; padding: 9px 12px; min-height: 40px; }
        .pl-go { color: var(--bone-mute); font-size: 20px; }
      `}</style>
    </div>
  )
}
