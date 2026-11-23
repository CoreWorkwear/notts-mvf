import LoadIssue from './LoadIssue'
import ClubImage from './ClubImage'
import Sheet from './Sheet'
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useMedia } from '../hooks/useMedia'
import { friendlyError } from '../lib/errors'
import ImageUpload from './ImageUpload'
import Loader from './Loader'
import Toast from './Toast'

// Admin club media (HANDOVER §6): the crest + the club photo pool that sits
// behind the poster heroes. Player headshots and opponent badges are managed
// where those records live (Players / fixtures).
export default function MediaPanel() {
  const { club } = useAuth()
  const { photos, loading, error, refetch, addPhoto, removePhoto, setCrest } = useMedia()
  const [viewing, setViewing] = useState(null)
  const [toast, setToast] = useState(null)

  // By the time these run the file is already in Storage, so a failed row write
  // is "uploaded, but…" — it has to be said out loud, not lost as a rejection.
  async function onCrest(url) {
    const { error } = await setCrest(url)
    if (error) setToast(`Uploaded, but couldn't set it as the crest. ${friendlyError(error, 'Try again.')}`)
  }
  async function onPhoto(url) {
    const { error } = await addPhoto(url)
    if (error) setToast(`Uploaded, but couldn't add it to the club photos. ${friendlyError(error, 'Try again.')}`)
  }
  async function onRemove(id) {
    const { error } = await removePhoto(id)
    if (error) setToast(`Couldn't remove that photo. ${friendlyError(error, 'Try again.')}`)
  }

  if (loading && !photos.length) return <Loader layout="gallery" label="Loading media…" />

  return (
    <div className="mt-4 col gap-5">
      <Toast message={toast} onDismiss={() => setToast(null)} />
      <div>
        <p className="kicker"><span className="kicker-rule">CLUB CREST</span></p>
        <div className="mt-3">
          <ImageUpload folder="crest" shape="round" current={club?.crest_url} label={club?.crest_url ? 'Replace crest' : 'Upload crest'}
            maxDim={512} onUploaded={onCrest} />
        </div>
      </div>

      <div>
        <p className="kicker"><span className="kicker-rule">CLUB PHOTOS</span></p>
        <div className="mt-3">
          <ImageUpload folder="photos" shape="square" multiple label="Add club photos" onUploaded={onPhoto} />
        </div>

        {error && <LoadIssue subject="the club photos" retry={refetch} stale={photos.length > 0} />}
        {photos.length === 0 ? (!error &&
          <p className="dim mt-3" style={{ fontSize: 'var(--type-sm)' }}>No club photos</p>
        ) : (
          <div className="photo-grid mt-3">
            {photos.map((p, index) => (
              <div key={p.id} className="photo-cell">
                <button className="photo-open" aria-label={'Open club photo ' + (index + 1)} onClick={() => setViewing({ url: p.url, index })}>
                  <ClubImage src={p.url} sizes="(min-width: 780px) 240px, 30vw" alt="" />
                </button>
                <button className="photo-del" onClick={() => onRemove(p.id)} aria-label="Remove photo">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Sheet open={!!viewing} onClose={() => setViewing(null)}>
        {viewing && <>
          <h2 className="display">Club photo {viewing.index + 1}</h2>
          <img className="photo-viewer" src={viewing.url} alt={'Club photo ' + (viewing.index + 1)} />
          <div className="sheet-actions"><button className="btn btn-ghost btn-block" onClick={() => setViewing(null)}>Close photo</button></div>
        </>}
      </Sheet>
      <style>{`
        .photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-2); }
        .photo-cell { position: relative; aspect-ratio: 4/3; border-radius: var(--r-card); overflow: hidden; border: 1px solid var(--line); }
        .photo-cell img { width: 100%; height: 100%; object-fit: cover; }
        .photo-del { position: absolute; top: 0; right: 0; width: var(--target); height: var(--target); border-radius: 50%;
          background: var(--surface-input); color: var(--text); border: none; font-size: var(--type-sm); line-height: 1; }
      `}</style>
    </div>
  )
}
