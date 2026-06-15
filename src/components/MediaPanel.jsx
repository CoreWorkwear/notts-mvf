import { useAuth } from '../context/AuthContext'
import { useMedia } from '../hooks/useMedia'
import ImageUpload from './ImageUpload'
import Loader from './Loader'

// Admin club media (HANDOVER §6): the crest + the club photo pool that sits
// behind the poster heroes. Player headshots and opponent badges are managed
// where those records live (Players / fixtures).
export default function MediaPanel() {
  const { club } = useAuth()
  const { photos, loading, addPhoto, removePhoto, setCrest } = useMedia()

  if (loading) return <Loader label="Loading the club media…" />

  return (
    <div className="mt-4 col gap-5">
      <div>
        <p className="kicker"><span className="kicker-rule">CLUB CREST</span></p>
        <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>Shows in the header, on login and across the poster heroes.</p>
        <div className="mt-3">
          <ImageUpload folder="crest" shape="round" current={club?.crest_url} label={club?.crest_url ? 'Replace crest' : 'Upload crest'}
            maxDim={512} onUploaded={(url) => setCrest(url)} />
        </div>
      </div>

      <div>
        <p className="kicker"><span className="kicker-rule">CLUB PHOTOS</span></p>
        <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>Used at random behind fixture & result heroes (pin one to a game from its detail). Pick several at once — picture files only.</p>
        <div className="mt-3">
          <ImageUpload folder="photos" shape="square" multiple label="Add club photos" onUploaded={(url) => addPhoto(url)} />
        </div>

        {photos.length === 0 ? (
          <p className="dim mt-3" style={{ fontSize: 14 }}>No club photos yet — add a few matchday shots.</p>
        ) : (
          <div className="photo-grid mt-3">
            {photos.map((p) => (
              <div key={p.id} className="photo-cell">
                <img src={p.url} alt="" />
                <button className="photo-del" onClick={() => removePhoto(p.id)} aria-label="Remove photo">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        .photo-cell { position: relative; aspect-ratio: 4/3; border-radius: 12px; overflow: hidden; border: 1px solid var(--line); }
        .photo-cell img { width: 100%; height: 100%; object-fit: cover; }
        .photo-del { position: absolute; top: 6px; right: 6px; width: 26px; height: 26px; border-radius: 50%;
          background: rgba(0,0,0,.6); color: #fff; border: none; font-size: 13px; line-height: 1; }
      `}</style>
    </div>
  )
}
