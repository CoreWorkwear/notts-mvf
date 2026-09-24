import { useState } from 'react'
import { useSponsors } from '../hooks/useSponsors'
import SponsorForm, { SPONSOR_TIERS } from '../components/SponsorForm'
import Loader from '../components/Loader'
import Toast from '../components/Toast'

export default function Sponsors() {
  const { sponsors, loading, error, save, remove, refetch } = useSponsors()
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState(null)

  const openAdd = () => { setEditing(null); setOpen(true) }
  const openEdit = (s) => { setEditing(s); setOpen(true) }

  async function onRemove(s) {
    if (!confirm(`Remove ${s.name}?`)) return
    try { await remove(s.id) } catch { setToast("Couldn't remove that sponsor — give it another go.") }
  }

  // Only the first load gets the Loader: a refetch after a save flips loading
  // too, and swapping the page out would unmount the open SponsorForm sheet.
  if (loading && sponsors.length === 0) return <Loader label="Loading sponsors…" />

  // A failed first load is not "None yet." under every tier: say so, offer a retry.
  if (error && sponsors.length === 0) return (
    <div className="page">
      <div className="empty mt-5" role="alert">
        <p className="empty-title">Couldn't load the sponsors</p>
        <p>Looks like a dodgy connection. Have another go.</p>
        <button className="btn btn-primary mt-3" onClick={refetch}>Try again</button>
      </div>
    </div>
  )

  return (
    <div className="page">
      <Toast message={toast} onDismiss={() => setToast(null)} />
      <p className="kicker"><span className="kicker-rule">SPONSORS</span></p>
      <h1 className="display mt-2" style={{ fontSize: 28 }}>Club sponsors</h1>
      {error && <p className="dim mt-2" role="status" style={{ fontSize: 13 }}>Couldn't refresh just now — showing what we had.</p>}
      <p className="muted mt-2" style={{ fontSize: 14 }}>Logos carry through the app — the main sponsor leads, the kit sponsor sits beneath, and the Man-of-the-Match sponsor gets a line on results.</p>

      <button className="btn btn-primary btn-block mt-3" onClick={openAdd}>+ Add a sponsor</button>

      {SPONSOR_TIERS.map((t) => {
        const list = sponsors.filter((s) => s.tier === t.key)
        return (
          <div key={t.key} className="mt-5">
            <p className="kicker" style={{ color: 'var(--bone-mute)' }}>{t.label} · {list.length}</p>
            {list.length === 0 ? (
              <p className="dim mt-2" style={{ fontSize: 14 }}>None yet.</p>
            ) : (
              <div className="col gap-2 mt-2">
                {list.map((s) => (
                  <button key={s.id} className="card sp-row" onClick={() => openEdit(s)} style={s.active ? {} : { opacity: 0.55 }}>
                    {s.logo_url
                      ? <span className="sp-thumb"><img src={s.logo_url} alt="" /></span>
                      : <span className="sp-thumb sp-thumb-empty mono">{(s.name?.[0] ?? '?').toUpperCase()}</span>}
                    <span className="grow" style={{ textAlign: 'left' }}>
                      <span style={{ fontWeight: 600 }}>{s.name}</span>
                      {!s.active && <span className="dim" style={{ fontSize: 12 }}> · hidden</span>}
                      {s.website && <span className="dim" style={{ fontSize: 12, display: 'block' }}>{s.website}</span>}
                    </span>
                    <span role="button" tabIndex={0} className="sp-del" aria-label="Remove sponsor"
                      onClick={(e) => { e.stopPropagation(); onRemove(s) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onRemove(s) } }}>✕</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}

      <SponsorForm open={open} sponsor={editing} onClose={() => setOpen(false)} onSave={save} />

      <style>{`
        .sp-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: var(--coal);
          color: var(--bone); border: 1px solid var(--line); text-align: left; }
        .sp-thumb { width: 48px; height: 40px; flex: none; border-radius: 8px; background: var(--bone);
          display: grid; place-items: center; overflow: hidden; }
        .sp-thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .sp-thumb-empty { background: var(--slate); color: var(--bone-mute); font-weight: 700; }
        .sp-del { color: var(--bone-dim); font-size: 16px; padding: 4px 8px; }
      `}</style>
    </div>
  )
}
