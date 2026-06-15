import { useEffect, useRef, useState } from 'react'
import Sheet from './Sheet'
import Toast from './Toast'
import ImageUpload from './ImageUpload'

// Add/edit an opponent (BUILD-LIST A2). Quick path: just a name. Or enrich a
// regular league side with home ground, badge, and the league flag.
export default function OpponentForm({ open, onClose, onSave, opponent }) {
  const editing = !!opponent
  const [name, setName] = useState('')
  const [homeVenue, setHomeVenue] = useState('')
  const [isLeague, setIsLeague] = useState(false)
  const [badgeUrl, setBadgeUrl] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [invalid, setInvalid] = useState(false)
  const formRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setError(null); setInvalid(false)
    setName(opponent?.name ?? '')
    setHomeVenue(opponent?.home_venue ?? '')
    setIsLeague(opponent?.is_league_team ?? false)
    setBadgeUrl(opponent?.badge_url ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (invalid) formRef.current?.querySelector('[aria-invalid="true"]')?.focus?.({ preventScroll: false })
  }, [invalid])

  async function onSubmit(e) {
    e.preventDefault()
    if (!name.trim()) { setInvalid(true); setError('Give the opponent a name.'); return }
    setBusy(true); setError(null)
    try {
      await onSave({ id: opponent?.id, name, home_venue: homeVenue, is_league_team: isLeague, badge_url: badgeUrl })
      onClose()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <Toast message={error} onDismiss={() => setError(null)} />
      <p className="kicker"><span className="kicker-rule">{editing ? 'EDIT OPPONENT' : 'ADD OPPONENT'}</span></p>
      <h2 className="display mt-2" style={{ fontSize: 24 }}>{editing ? name : 'New opponent'}</h2>

      <form className="col gap-3 mt-4" onSubmit={onSubmit} ref={formRef}>
        <div className="field">
          <label className="label">Name</label>
          <input className="input" value={name} aria-invalid={invalid || undefined}
            onChange={(e) => { setName(e.target.value); setInvalid(false) }} placeholder="e.g. Carlton Town" />
        </div>

        <div className="field">
          <label className="label">Home ground (optional)</label>
          <input className="input" value={homeVenue} onChange={(e) => setHomeVenue(e.target.value)} />
        </div>

        <div className="field">
          <label className="label">Type</label>
          <button type="button" className={'chip' + (isLeague ? ' paid-on' : '')} aria-pressed={isLeague} onClick={() => setIsLeague((v) => !v)}>
            {isLeague ? 'League team ✓' : 'One-off / friendly'}
          </button>
          <p className="dim" style={{ fontSize: 12, marginTop: 6 }}>League teams you'll meet again — worth a badge. One-offs can stay name-only.</p>
        </div>

        <div className="field">
          <label className="label">Badge</label>
          <ImageUpload folder="opponents" shape="round" maxDim={256} current={badgeUrl}
            label={badgeUrl ? 'Replace badge' : 'Add badge'} onUploaded={(url) => setBadgeUrl(url)} />
        </div>

        <button className="btn btn-primary btn-block mt-2" disabled={busy}>
          {busy ? 'Saving…' : editing ? 'Save opponent' : 'Add opponent'}
        </button>
      </form>
    </Sheet>
  )
}
