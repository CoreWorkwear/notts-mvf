import { useEffect, useState } from 'react'
import Sheet from './Sheet'
import Toast from './Toast'

// Admin: post a club news item, optionally pushing it to everyone's phones.
// Ticking "push" with a short message is also the ad-hoc broadcast.
export default function NewsForm({ open, onClose, onPost }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [push, setPush] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null) // shown AFTER the sheet closes: posted, but the push failed

  useEffect(() => {
    if (!open) return
    setTitle(''); setBody(''); setPush(true); setError(null); setNotice(null); setBusy(false)
  }, [open])

  async function onSubmit(e) {
    e.preventDefault()
    if (!title.trim() || !body.trim()) { setError('Add a headline and a message.'); return }
    setBusy(true); setError(null)
    try {
      const res = await onPost({ title, body, push })
      onClose()
      // The post is in — but the manager needs to know nobody's phone buzzed.
      if (res?.pushFailed) setNotice("Posted, but the push didn't go out — players will still see it in News.")
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <>
      {/* Outside the sheet so it outlives the close (a closed sheet unmounts its children). */}
      <Toast message={notice} onDismiss={() => setNotice(null)} />
      <Sheet open={open} onClose={onClose}>
        <Toast message={error} onDismiss={() => setError(null)} />
        <p className="kicker"><span className="kicker-rule">POST NEWS</span></p>
        <h2 className="display mt-2" style={{ fontSize: 24 }}>Tell the squad</h2>

        <form className="col gap-3 mt-4" onSubmit={onSubmit}>
          <div className="field">
            <label className="label">Headline</label>
            <input className="input" aria-label="Headline" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Training moved to Thursday" />
          </div>
          <div className="field">
            <label className="label">Message</label>
            <textarea className="input" rows={4} aria-label="Message" value={body} onChange={(e) => setBody(e.target.value)} style={{ resize: 'vertical' }} />
          </div>
          <button type="button" className={'chip' + (push ? ' paid-on' : '')} aria-pressed={push} onClick={() => setPush((p) => !p)}>
            {push ? 'Push to everyone ✓' : 'Post quietly (no push)'}
          </button>
          <button className="btn btn-primary btn-block mt-2" disabled={busy}>
            {busy ? 'Posting…' : push ? 'Post & notify' : 'Post'}
          </button>
        </form>
      </Sheet>
    </>
  )
}
