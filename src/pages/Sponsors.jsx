import ClubImage from '../components/ClubImage'
import { useState } from 'react'
import { useSponsors } from '../hooks/useSponsors'
import SponsorForm, { SPONSOR_TIERS } from '../components/SponsorForm'
import Loader from '../components/Loader'
import Toast from '../components/Toast'
import PageHead from '../components/PageHead'

export default function Sponsors() {
  const { sponsors, loading, loaded, error, save, remove, refetch } = useSponsors()
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState(null)

  const openAdd = () => { setEditing(null); setOpen(true) }
  const openEdit = (s) => { setEditing(s); setOpen(true) }

  async function onRemove(s) {
    if (!confirm(`Remove ${s.name}?`)) return
    try { await remove(s.id) } catch { setToast("Couldn't remove sponsor. Try again.") }
  }

  // Only the first load gets the Loader: a refetch after a save flips loading
  // too, and swapping the page out would unmount the open SponsorForm sheet.
  // "First" is the hook's `loaded`, not an empty list: saving the first-ever
  // sponsor refetches with none listed yet.
  const firstLoad = !loaded && sponsors.length === 0
  if (loading && firstLoad) return <Loader route="sponsors" label="Loading sponsors…" />

  // A failed first load is not "None yet." under every tier: say so, offer a retry.
  if (error && firstLoad) return (
    <div className="page">
      <div className="empty mt-5" role="alert">
        <p className="empty-title">Couldn't load the sponsors</p>
        <button className="btn btn-primary mt-3" onClick={refetch}>Try again</button>
      </div>
    </div>
  )

  return (
    <div className="page">
      <Toast message={toast} onDismiss={() => setToast(null)} />
      <PageHead kicker="SPONSORS" title="Club sponsors" />
      {error && <p className="dim mt-2" role="status" style={{ fontSize: 'var(--type-sm)' }}>Couldn't refresh. Showing saved sponsors.</p>}


      <button className="btn btn-primary btn-block mt-3" onClick={openAdd}>+ Add a sponsor</button>

      {SPONSOR_TIERS.map((t) => {
        const list = sponsors.filter((s) => s.tier === t.key)
        return (
          <div key={t.key} className="mt-5 reveal-native">
            <p className="kicker" style={{ color: 'var(--bone-mute)' }}>{t.label} · {list.length}</p>
            {list.length === 0 ? (
              <p className="dim mt-2" style={{ fontSize: 'var(--type-sm)' }}>None yet.</p>
            ) : (
              <div className="col gap-2 mt-2">
                {list.map((s) => (
                  <div key={s.id} className="card sp-row">
                    <button type="button" className="sp-edit" onClick={() => openEdit(s)} aria-label={`Edit ${s.name}${s.active ? '' : ' (hidden)'}`}>
                      {s.logo_url
                        ? <span className="sp-thumb"><ClubImage sizes="64px" src={s.logo_url} alt="" /></span>
                        : <span className="sp-thumb sp-thumb-empty mono">{(s.name?.[0] ?? '?').toUpperCase()}</span>}
                      <span className="sp-info">
                        <strong>{s.name}</strong>
                        {!s.active && <span className="dim"> · hidden</span>}
                        {s.website && <span className="sp-website dim">{s.website}</span>}
                      </span>
                    </button>
                    <button type="button" className="sp-del" aria-label={`Remove ${s.name}`} onClick={() => onRemove(s)}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      <SponsorForm open={open} sponsor={editing} onClose={() => setOpen(false)} onSave={save} />

      <style>{`
        .sp-row { display: grid; grid-template-columns: minmax(0,1fr) var(--target); align-items: center;
          gap: var(--space-2); padding: var(--space-2); background: var(--coal); color: var(--bone); border: 1px solid var(--line); }
        .sp-edit, .sp-del { min-block-size: var(--target); min-inline-size: var(--target); padding: 0; border: 0;
          border-radius: var(--r-input); background: transparent; color: inherit; }
        .sp-edit { display: flex; align-items: center; gap: var(--space-2); text-align: start; }
        .sp-info { min-inline-size: 0; overflow-wrap: anywhere; }
        .sp-info .dim { font-size: var(--type-caption); }
        .sp-website { display: block; }
        .sp-thumb { width: 48px; height: 40px; flex: none; border-radius: 8px; background: var(--bone);
          display: grid; place-items: center; overflow: hidden; }
        .sp-thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .sp-thumb-empty { background: var(--slate); color: var(--bone-mute); font-weight: 700; }
        .sp-del { color: var(--bone-mute); font-size: var(--type-body); }
      `}</style>
    </div>
  )
}
