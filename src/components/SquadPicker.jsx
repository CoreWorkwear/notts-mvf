import { useMemo, useState } from 'react'
import Sheet from './Sheet'
import Toast from './Toast'
import { usePlayers } from '../hooks/usePlayers'
import { useCompetitionSquad } from '../hooks/useCompetitionSquad'
import { squadCountLabel, squadFull } from '../lib/squad'

// Manager: register the squad for a competition (§2). A registration LIST only —
// it does NOT gate who sees or answers fixtures. The cap (if set) is shown and
// enforced (DB-guarded too); when full, only de-registering is possible.
export default function SquadPicker({ open, onClose, competition }) {
  const { players, loading: pl } = usePlayers()
  const { registered, count, loading: sl, add, remove } = useCompetitionSquad(open ? competition?.id : null)
  const [error, setError] = useState(null)
  const [q, setQ] = useState('')

  const squad = useMemo(
    () => (players ?? []).filter((p) => p.active && p.is_player)
      .filter((p) => `${p.first_name} ${p.last_name}`.toLowerCase().includes(q.trim().toLowerCase())),
    [players, q]
  )
  if (!competition) return null

  const enabled = competition.squad_limit_enabled
  const limit = competition.squad_limit
  const full = squadFull({ count, enabled, limit })

  async function toggle(p) {
    const isIn = registered.has(p.id)
    if (!isIn && full) { setError(`Squad is full (${count} / ${limit}). Remove someone first.`); return }
    const { error } = isIn ? await remove(p.id) : await add(p.id)
    if (error) setError(/full/i.test(error.message) ? error.message : 'Could not update the squad.')
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <Toast message={error} tone="error" onDismiss={() => setError(null)} />
      <p className="kicker"><span className="kicker-rule">REGISTERED SQUAD</span></p>
      <h2 className="display mt-2" style={{ fontSize: 24 }}>{competition.name}</h2>
      <p className={'sq-count mono mt-1' + (full ? ' full' : '')}>{squadCountLabel({ count, enabled, limit })}{full ? ' · full' : ''}</p>
      <p className="dim" style={{ fontSize: 12 }}>Registration only — it doesn't change who sees fixtures or sets availability.</p>

      <input className="input mt-3" placeholder="Search players…" value={q} onChange={(e) => setQ(e.target.value)} />

      {(pl || sl) ? <p className="muted mt-4 center">Loading…</p> : (
        <div className="col gap-2 mt-3">
          {squad.map((p) => {
            const isIn = registered.has(p.id)
            return (
              <div key={p.id} className="sq-row">
                {p.photo_url ? <img className="sq-av" src={p.photo_url} alt="" />
                  : <span className="sq-av mono">{`${p.first_name?.[0] ?? ''}${p.last_name?.[0] ?? ''}`.toUpperCase()}</span>}
                <span className="grow">{p.first_name} {p.last_name}{p.preferred ? <span className="dim"> · {p.preferred}</span> : null}</span>
                <button type="button" className={'chip' + (isIn ? ' paid-on' : '')} aria-pressed={isIn}
                  disabled={!isIn && full} onClick={() => toggle(p)}>
                  {isIn ? 'Registered ✓' : full ? 'Full' : 'Register'}
                </button>
              </div>
            )
          })}
          {squad.length === 0 && <p className="dim center" style={{ fontSize: 14 }}>No players match.</p>}
        </div>
      )}

      <style>{`
        .sq-count { font-size: 14px; color: var(--bone-mute); }
        .sq-count.full { color: var(--amber); }
        .sq-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); }
        .sq-av { width: 34px; height: 34px; border-radius: 50%; flex: none; object-fit: cover; display: grid; place-items: center;
          background: var(--slate); border: 1px solid var(--line-2); font-size: 12px; font-weight: 600; }
        .chip.paid-on { background: var(--green-dim-2); border-color: var(--green); color: var(--green-bright); }
      `}</style>
    </Sheet>
  )
}
