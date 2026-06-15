import { useEffect, useState } from 'react'
import Sheet from './Sheet'
import AvailControl from './AvailControl'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { fmtDateLong, fmtKO } from '../lib/format'
import { heroBackground } from '../lib/media'
import { setPinnedImage } from '../hooks/useFixtures'
import WeatherStrip from './WeatherStrip'
import { inForecastWindow } from '../lib/weather'
import { osmEmbedUrl, directionsUrl, mapSearchUrl } from '../lib/maps'

// Fixture detail: poster header, My availability, venue + directions, Who's in.
// Admins can pin a club photo to this game's poster.
export default function FixtureDetail({ open, onClose, fixture, isAdmin, canRespond = true, pool = [], canLogResult, onSetAvail, onEdit, onLogResult, onChanged }) {
  const { user } = useAuth()
  const [tab, setTab] = useState('me')
  const [rows, setRows] = useState([])
  const [photoAssets, setPhotoAssets] = useState([]) // [{id,url}] for the pin picker

  useEffect(() => {
    if (!open || !fixture) return
    setTab('me')
    supabase
      .from('availability')
      .select('status, profile:profiles(id, first_name, last_name)')
      .eq('fixture_id', fixture.id)
      .then(({ data }) => setRows(data ?? []))
    if (isAdmin) {
      supabase.from('media_assets').select('id, url').eq('type', 'photo')
        .then(({ data }) => setPhotoAssets(data ?? []))
    }
  }, [open, fixture, isAdmin])

  if (!fixture) return null
  const f = fixture
  const isXL = f.team?.key === 'xl'
  const grad = isXL ? 'var(--grad-xl)' : 'var(--grad-community)'

  async function pin(mediaId) {
    await setPinnedImage(f.id, f.pinned_image_id === mediaId ? null : mediaId)
    onChanged?.()
  }
  const w3wUrl = f.w3w ? `https://what3words.com/${f.w3w.replace(/^\/+/, '')}` : null
  const mapEmbed = osmEmbedUrl(f.venue_lat, f.venue_lng)
  const dirUrl = directionsUrl({ lat: f.venue_lat, lng: f.venue_lng, address: f.address, venue: f.venue })
  const mapsUrl = mapSearchUrl({ lat: f.venue_lat, lng: f.venue_lng, address: f.address, venue: f.venue })
  const showWeather = inForecastWindow(f.match_date)

  const group = (s) => rows.filter((r) => r.status === s)
  const name = (r) => `${r.profile?.first_name ?? '?'} ${(r.profile?.last_name ?? '').slice(0, 1)}`
  const isMe = (r) => r.profile?.id === user?.id

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="det-hero" style={{ backgroundImage: heroBackground({ pinnedUrl: f.pinnedUrl, pool, seed: f.id, gradient: grad }), backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <span className="kicker" style={{ color: 'rgba(255,255,255,.85)' }}>{f.team?.label} · {f.home_away} · {f.fixture_type}</span>
        <h2 className="display" style={{ fontSize: 32, color: '#fff', marginTop: 6 }}>{f.opponent?.name}</h2>
        <p className="mono" style={{ color: 'rgba(255,255,255,.9)', fontSize: 13, marginTop: 4 }}>
          {fmtDateLong(f.match_date)} · {fmtKO(f.kickoff)} KO
        </p>
        <div className="mt-2"><WeatherStrip fixture={f} light detailed /></div>
        {isAdmin && <button className="btn btn-ghost det-edit" onClick={onEdit}>Edit fixture</button>}
      </div>

      {canLogResult && (
        <button className="btn btn-primary btn-block mt-4" onClick={onLogResult}>
          Log the result
        </button>
      )}

      <div className="row gap-2 mt-4">
        <button className={'btn grow ' + (tab === 'me' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('me')}>My availability</button>
        <button className={'btn grow ' + (tab === 'who' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('who')}>Who's in</button>
      </div>

      {tab === 'me' ? (
        <div className="mt-4">
          {canRespond
            ? <AvailControl value={f.myStatus} onChange={onSetAvail} />
            : <p className="muted" style={{ fontSize: 14 }}>You can set your availability once the manager's signed you off.</p>}

          {showWeather && (
            <>
              <p className="kicker mt-5"><span className="kicker-rule">MATCH-DAY WEATHER</span></p>
              <div className="mt-2"><WeatherStrip fixture={f} card /></div>
            </>
          )}

          <p className="kicker mt-5"><span className="kicker-rule">VENUE &amp; DIRECTIONS</span></p>
          <p className="mt-2" style={{ fontWeight: 600 }}>{f.venue}</p>
          {(f.address || f.postcode) && (
            <p className="muted" style={{ fontSize: 14 }}>{[f.address, f.postcode].filter(Boolean).join(', ')}</p>
          )}
          {mapEmbed && (
            <iframe className="venue-map mt-3" src={mapEmbed} title={`Map of ${f.venue}`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
          )}
          <div className="row gap-2 mt-3">
            {dirUrl && <a className="btn btn-primary grow" href={dirUrl} target="_blank" rel="noreferrer">Get directions</a>}
            {mapsUrl && <a className="btn btn-ghost grow" href={mapsUrl} target="_blank" rel="noreferrer">Open in Maps</a>}
            {w3wUrl && <a className="btn btn-ghost grow" href={w3wUrl} target="_blank" rel="noreferrer">{f.w3w}</a>}
          </div>

          {isAdmin && photoAssets.length > 0 && (
            <>
              <p className="kicker mt-5"><span className="kicker-rule">POSTER PHOTO</span></p>
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>Pin one to this game, or leave it on the random club shot.</p>
              <div className="pin-row mt-2">
                {photoAssets.map((a) => (
                  <button key={a.id} className={'pin-thumb' + (f.pinned_image_id === a.id ? ' on' : '')} onClick={() => pin(a.id)} aria-label="Pin this photo">
                    <img src={a.url} alt="" />
                  </button>
                ))}
              </div>
              <style>{`
                .pin-row { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
                .pin-thumb { flex: none; width: 72px; height: 54px; border-radius: 10px; overflow: hidden;
                  border: 2px solid var(--line); padding: 0; background: none; }
                .pin-thumb.on { border-color: var(--red); box-shadow: 0 0 0 3px var(--red-dim); }
                .pin-thumb img { width: 100%; height: 100%; object-fit: cover; }
              `}</style>
            </>
          )}
        </div>
      ) : (
        <div className="mt-4 col gap-4">
          <WhoGroup title="Available" colour="var(--green-bright)" rows={group('in')} name={name} isMe={isMe} />
          <WhoGroup title="Maybe" colour="var(--amber)" rows={group('maybe')} name={name} isMe={isMe} />
          <WhoGroup title="Can't make it" colour="var(--red-bright)" rows={group('out')} name={name} isMe={isMe} />
          <p className="muted center" style={{ fontSize: 14 }}>{f.noReply} not replied yet</p>
        </div>
      )}

      <style>{`
        .det-hero { border-radius: var(--r-hero); padding: 16px; position: relative; }
        .det-edit { position: absolute; top: 14px; right: 14px; padding: 5px 12px; font-size: 13px;
          background: rgba(0,0,0,.25); color: #fff; border-color: rgba(255,255,255,.25); }
        .venue-map { width: 100%; height: 200px; border: 1px solid var(--line); border-radius: 12px; display: block; }
      `}</style>
    </Sheet>
  )
}

function WhoGroup({ title, colour, rows, name, isMe }) {
  return (
    <div>
      <p className="kicker" style={{ color: colour }}>{title} · {rows.length}</p>
      {rows.length === 0 ? (
        <p className="dim mt-2" style={{ fontSize: 14 }}>—</p>
      ) : (
        <div className="row gap-2 mt-2" style={{ flexWrap: 'wrap' }}>
          {rows.map((r, i) => (
            <span key={i} className="chip" style={isMe(r) ? { borderColor: colour, color: colour } : {}}>
              {name(r)}{isMe(r) ? ' · YOU' : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
