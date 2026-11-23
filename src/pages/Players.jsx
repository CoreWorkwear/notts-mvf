import { TEAMS } from '../lib/constants'
import ClubImage from '../components/ClubImage'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { logError } from '../lib/logger'
import { useAuth } from '../context/AuthContext'
import { usePlayers } from '../hooks/usePlayers'
import PlayerForm from '../components/PlayerForm'
import Loader from '../components/Loader'
import Toast from '../components/Toast'
import PageHead from '../components/PageHead'

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
  // Supporters are signed off like players now (a pending account sees nothing
  // club-wide), so the queue holds both; once approved a supporter moves to
  // the Supporters list.
  const pendingList = filtered.filter((p) => p.active && !p.approved)
  const squadList = filtered.filter((p) => p.active && p.is_player && p.approved)
  const supporterList = filtered.filter((p) => p.active && !p.is_player && p.approved)
  const inactiveList = filtered.filter((p) => !p.active)

  const openAdd = () => { setEditing(null); setFormOpen(true) }
  const openEdit = (p) => { setEditing(p); setFormOpen(true) }

  // One-tap manager sign-off, for players and supporters alike: it only flips
  // `approved` (no squad membership is added — squads are granted in the form).
  // RLS lets an admin set approved; the protect trigger blocks everyone else.
  async function approve(id) {
    const { error } = await supabase.from('profiles').update({ approved: true }).eq('id', id)
    if (error) { setToast("Sign-off failed. Try again."); return }
    refetch()
  }

  // Only the FIRST load gets the Loader: a refetch after a save flips loading
  // true too, and swapping the page out would unmount the open PlayerForm sheet.
  if (loading && players.length === 0) return <Loader route="players" label="Loading players…" />

  // A failed first load is not an empty squad: say so and offer a retry.
  if (error && players.length === 0) return (
    <div className="page">
      <div className="empty mt-5" role="alert">
        <p className="empty-title">Couldn't load the squad</p>
        <button className="btn btn-primary mt-3" onClick={() => { refetch(); if (teamsError) loadTeams() }}>Try again</button>
      </div>
    </div>
  )

  return (
    <div className="page">
      <Toast message={toast} onDismiss={() => setToast(null)} />
      <PageHead kicker="THE SQUAD" title="Players" />
      {error && <p className="dim mt-2" role="status" style={{ fontSize: 'var(--type-sm)' }}>Couldn't refresh. Showing saved players.</p>}

      <input className="input mt-3" placeholder="Search players…" value={q} onChange={(e) => setQ(e.target.value)} />
      <button className="btn btn-primary btn-block mt-3" onClick={openAdd}>+ Add a player</button>

      {teamsError && teams.length === 0 && (
        <div className="card mt-3" role="alert" style={{ padding: 'var(--space-3)', borderColor: 'var(--amber)' }}>
          <p style={{ fontWeight: 600 }}>Squads didn't load.</p>
          <p className="dim mt-1" style={{ fontSize: 'var(--type-sm)' }}>Squad editing unavailable</p>
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
        empty ? <p className="dim mt-2" style={{ fontSize: 'var(--type-sm)' }}>{empty}</p> : null
      ) : (
        <div className="pl-list col gap-2 mt-2">
          {list.map((p) => (
            <div key={p.id} className="card pl-row" style={muted ? { color: 'var(--text-muted)' } : undefined}>
              <button type="button" className="pl-edit" onClick={() => onEdit(p)}
                aria-label={`Edit ${p.first_name} ${p.last_name}${p.id === meId ? ' · you' : ''}`}
                aria-describedby={`pl-tags-${p.id}`}>
                {p.photo_url
                  ? <ClubImage sizes="40px" className="pl-av" src={p.photo_url} alt="" />
                  : <span className="pl-av mono">{`${(p.first_name?.[0] ?? '')}${(p.last_name?.[0] ?? '')}`.toUpperCase()}</span>}
                <span className="pl-main">
                  <span className="pl-name">{p.first_name} {p.last_name}{p.id === meId ? ' · you' : ''}</span>
                  <span className="pl-tags" id={`pl-tags-${p.id}`}>
                    {!p.is_player && <span className="tag tag-supporter">Supporter</span>}
                    {p.is_player && !p.approved && <span className="tag tag-player">Player</span>}
                    {!p.approved && <span className="tag tag-pending">Pending</span>}
                    {p.teamKeys.includes('xl') && <span className="tag tag-xl">{TEAMS.xl.label}</span>}
                    {p.teamKeys.includes('community') && <span className="tag tag-co">{TEAMS.community.label}</span>}
                    {p.role === 'admin' && <span className="tag tag-admin">Manager</span>}
                  </span>
                </span>
              </button>
              {onApprove && (
                <button type="button" className="pl-approve" onClick={() => onApprove(p.id)}
                  aria-label={`Sign off ${p.first_name} ${p.last_name}`}>
                  Sign off
                </button>
              )}
              <span aria-hidden="true" className="pl-go">›</span>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .pl-list { container-type: inline-size; }
        .pl-row { position: relative; display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3); background: var(--coal);
          color: var(--bone); border: 1px solid var(--line); text-align: left; }
        .pl-edit { display: flex; flex: 1; min-width: 0; min-height: var(--target); align-items: center; gap: var(--space-3);
          padding: 0; border: 0; background: transparent; color: inherit; text-align: left; }
        .pl-edit::after { content: ""; position: absolute; inset: 0; border-radius: var(--r-card); }
        .pl-edit:focus-visible::after { outline: 2px solid var(--focus); outline-offset: -2px; }
        .pl-av { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center;
          background: var(--slate); border: 1px solid var(--line-2); font-size: var(--type-sm); font-weight: 600; flex: none;
          object-fit: cover; }
        .pl-main { flex: 1; min-width: 0; }
        .pl-name { display: block; overflow-wrap: anywhere; font-weight: 600; }
        .pl-tags { display: flex; gap: var(--space-1); flex-wrap: wrap; margin-top: var(--space-1); }
        .tag { font-size: var(--type-xs); letter-spacing: .04em; text-transform: uppercase; padding: var(--space-1) var(--space-2);
          border-radius: var(--r-input); background: var(--slate); color: var(--bone-mute); border: 1px solid var(--line); }
        .tag-xl { color: var(--red-bright); border-color: var(--red); }
        .tag-co { color: var(--green-bright); border-color: var(--green); }
        .tag-admin { color: var(--text-secondary); border-color: var(--border-strong); }
        .tag-pending { color: var(--amber); border-color: var(--amber); }
        .tag-player { color: var(--bone); border-color: var(--line-2); }
        .tag-supporter { color: var(--bone-mute); border-color: var(--line-2); }
        /* Solid fill + dark text so the action is unmistakable (was bright-on-dim, ~1.6:1). */
        .pl-approve { position: relative; z-index: 1; flex: none; min-width: var(--target); font-size: var(--type-sm); font-weight: 700; color: var(--on-action);
          border: none; background: var(--action-fill); border-radius: var(--r-input); padding: var(--space-2) var(--space-3); min-height: var(--target); }
        .pl-go { pointer-events: none; color: var(--bone-mute); font-size: var(--type-lg); }
        @container (width < 17em) {
          .pl-row:has(.pl-approve) { display: grid; grid-template-columns: minmax(0, 1fr) auto; }
          .pl-approve { grid-column: 1 / -1; grid-row: 2; justify-self: start; }
          .pl-go { grid-column: 2; grid-row: 1; }
        }
      `}</style>
    </div>
  )
}
