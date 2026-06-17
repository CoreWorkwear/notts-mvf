import { useRef, useState } from 'react'
import { uploadMedia } from '../lib/storage'
import Toast from './Toast'

// Admin image picker → resize → upload → onUploaded(publicUrl). Shows the
// current/just-uploaded image as a preview. round = crest/headshot, square = photo.
// A sensible default hint per shape; callers can override with `hint`.
const defaultHint = (shape, maxDim) =>
  shape === 'round'
    ? `Square works best — a head-and-shoulders shot (about ${Math.min(maxDim, 512)}×${Math.min(maxDim, 512)}px). We resize + crop to a circle.`
    : `Landscape works best (roughly 4:3 or 16:9). We shrink it to about ${maxDim}px and compress, so big phone photos are fine.`

export default function ImageUpload({ folder, onUploaded, current, label = 'Upload image', shape = 'square', maxDim = 1200, multiple = false, hint }) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const [preview, setPreview] = useState(current ?? null)

  async function onPick(e) {
    // Picture files only (the input's accept already filters), uploaded one by
    // one so a slow/oversized file doesn't lose the rest.
    const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    setBusy(true); setError(null)
    try {
      for (let i = 0; i < files.length; i++) {
        if (multiple) setProgress(`${i + 1}/${files.length}`)
        const url = await uploadMedia(files[i], folder, { maxDim })
        if (!multiple) setPreview(url)
        onUploaded(url)
      }
    } catch (err) {
      setError(err.message || 'Upload failed.')
    } finally {
      setBusy(false); setProgress(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const hintText = hint ?? defaultHint(shape, maxDim)

  return (
    <div className="iu-wrap">
      <Toast message={error} onDismiss={() => setError(null)} />
      <div className="iu">
        {!multiple && (
          <div className={'iu-preview ' + shape}>
            {preview ? <img src={preview} alt="" /> : <span className="iu-empty">—</span>}
          </div>
        )}
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? (progress ? `Uploading ${progress}…` : 'Uploading…') : label}
        </button>
        <input ref={inputRef} type="file" accept="image/*" multiple={multiple} hidden onChange={onPick} />
      </div>
      {hintText && <p className="iu-hint">{hintText}</p>}

      <style>{`
        .iu-wrap { display: flex; flex-direction: column; gap: 6px; }
        .iu-hint { font-size: 12px; color: var(--bone-dim); line-height: 1.35; margin: 0; }
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
