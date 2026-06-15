import { useRef, useState } from 'react'
import { uploadMedia } from '../lib/storage'
import Toast from './Toast'

// Admin image picker → resize → upload → onUploaded(publicUrl). Shows the
// current/just-uploaded image as a preview. round = crest/headshot, square = photo.
export default function ImageUpload({ folder, onUploaded, current, label = 'Upload image', shape = 'square', maxDim = 1200 }) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [preview, setPreview] = useState(current ?? null)

  async function onPick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setError(null)
    try {
      const url = await uploadMedia(file, folder, { maxDim })
      setPreview(url)
      onUploaded(url)
    } catch (err) {
      setError(err.message || 'Upload failed.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="iu">
      <Toast message={error} onDismiss={() => setError(null)} />
      <div className={'iu-preview ' + shape}>
        {preview ? <img src={preview} alt="" /> : <span className="iu-empty">—</span>}
      </div>
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? 'Uploading…' : label}
      </button>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={onPick} />

      <style>{`
        .iu { display: flex; align-items: center; gap: 12px; }
        .iu-preview { width: 56px; height: 56px; flex: none; overflow: hidden; background: var(--slate);
          border: 1px solid var(--line); display: grid; place-items: center; }
        .iu-preview.square { border-radius: 12px; }
        .iu-preview.round { border-radius: 50%; }
        .iu-preview img { width: 100%; height: 100%; object-fit: cover; }
        .iu-empty { color: var(--bone-dim); }
      `}</style>
    </div>
  )
}
