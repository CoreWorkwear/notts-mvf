import { useEffect, useRef, useState } from 'react'
import Sheet from './Sheet'
import Toast from './Toast'
import ImageUpload from './ImageUpload'

export const SPONSOR_TIERS = [
  { key: 'main', label: 'Main / team sponsor', blurb: 'Most prominent — leads the banner.' },
  { key: 'kit',  label: 'Kit sponsor',         blurb: 'Smaller, beneath the main sponsor.' },
  { key: 'motm', label: 'Man of the Match',    blurb: 'A small line by the MOTM on results.' },
]

// Admin add/edit a sponsor: name, tier (prominence), website, logo (picture).
export default function SponsorForm({ open, onClose, onSave, sponsor }) {
  const editing = !!sponsor
  const [name, setName] = useState('')
  const [tier, setTier] = useState('main')
  const [website, setWebsite] = useState('')
  const [logoUrl, setLogoUrl] = useState(null)
  const [active, setActive] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [invalid, setInvalid] = useState(false)
  const formRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setError(null); setInvalid(false)
    setName(sponsor?.name ?? '')
    setTier(sponsor?.tier ?? 'main')
    setWebsite(sponsor?.website ?? '')
    setLogoUrl(sponsor?.logo_url ?? null)
    setActive(sponsor?.active !== false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (invalid) formRef.current?.querySelector('[aria-invalid="true"]')?.focus?.({ preventScroll: false })
  }, [invalid])

  async function onSubmit(e) {
    e.preventDefault()
    if (!name.trim()) { setInvalid(true); setError('Give the sponsor a name.'); return }
    setBusy(true); setError(null)
    try {
      await onSave({ id: sponsor?.id, name, tier, website, logo_url: logoUrl, active })
      onClose()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <Toast message={error} tone="error" onDismiss={() => setError(null)} />
      <p className="kicker"><span className="kicker-rule">{editing ? 'EDIT SPONSOR' : 'ADD SPONSOR'}</span></p>
      <h2 className="display mt-2" style={{ fontSize: 24 }}>{editing ? name : 'New sponsor'}</h2>

      <form className="col gap-3 mt-4" onSubmit={onSubmit} ref={formRef}>
        <div className="field">
          <label className="label">Name</label>
          <input className="input" value={name} aria-invalid={invalid || undefined}
            onChange={(e) => { setName(e.target.value); setInvalid(false) }} placeholder="e.g. CoreWorkwear" />
        </div>

        <div className="field">
          <label className="label">Type</label>
          <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
            {SPONSOR_TIERS.map((t) => (
              <button type="button" key={t.key} className="chip" aria-pressed={tier === t.key} onClick={() => setTier(t.key)}>{t.label}</button>
            ))}
          </div>
          <span className="dim" style={{ fontSize: 12 }}>{SPONSOR_TIERS.find((t) => t.key === tier)?.blurb}</span>
        </div>

        <div className="field">
          <label className="label">Website (optional)</label>
          <input className="input" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="coreworkwear.com" />
        </div>

        <div className="field">
          <label className="label">Logo</label>
          <ImageUpload folder="sponsors" shape="square" maxDim={600} current={logoUrl}
            label={logoUrl ? 'Replace logo' : 'Upload logo'} onUploaded={(url) => setLogoUrl(url)} />
          <span className="dim" style={{ fontSize: 12 }}>A logo on a transparent or light background works best.</span>
        </div>

        {editing && (
          <button type="button" className="chip" aria-pressed={active} onClick={() => setActive((a) => !a)}
            style={{ color: active ? 'var(--green-bright)' : 'var(--bone-mute)' }}>
            {active ? 'Showing ✓' : 'Hidden'}
          </button>
        )}

        <button className="btn btn-primary btn-block mt-2" disabled={busy}>
          {busy ? 'Saving…' : editing ? 'Save sponsor' : 'Add sponsor'}
        </button>
      </form>
    </Sheet>
  )
}
