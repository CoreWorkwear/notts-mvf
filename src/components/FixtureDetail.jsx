import { useEffect, useState } from 'react'
import Sheet from './Sheet'
import Toast from './Toast'
import AvailControl from './AvailControl'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/errors'
import { logError } from '../lib/logger'
import { useAuth } from '../context/AuthContext'
import { fmtDateLong, fmtKO } from '../lib/format'
import { heroBackground } from '../lib/media'
import { setPinnedImage } from '../hooks/useFixtures'
import WeatherStrip from './WeatherStrip'
import TabBar from './TabBar'
import { inForecastWindow } from '../lib/weather'
import { osmEmbedUrl, directionsUrl, mapSearchUrl } from '../lib/maps'
import { teamMatchName } from '../lib/teams'
import LineupBoard from './LineupBoard'
import { respondBlockCopy, squadIds } from '../lib/players'

// Fixture detail: poster header, My availability, venue + directions, Who's in.
// Admins can pin a club photo to this game's poster.
// `blockReason` null = the viewer may answer; otherwise respondBlock()'s reason.
// This sheet is also how the Calendar opens a game, so it is the one surface
// that can be pointed at an already-played fixture — hence the kickoff reason.
export default function FixtureDetail({ open, onClose, fixture, isAdmin, blockReason = null, pool = [], canLogResult, onSetAvail, onEdit, onLogResult, onChanged }) {
  const { user } = useAuth()
  const [tab, setTab] = useState('me')
  const [rows, setRows] = useState([])
  const [whoLoading, setWhoLoading] = useState(false)
  const [whoError, setWhoError] = useState(null)
  const [whoAttempt, setWhoAttempt] = useState(0) // bumped by "Try again"
  const [photoAssets, setPhotoAssets] = useState([]) // [{id,url}] for the pin picker
  const [toast, setToast] = useState(null)
  // Local mirror of the viewer's status so the control reflects a change at once
  // — the `fixture` prop is a frozen snapshot from the parent's list (§2.2).
  const [myStatus, setMyStatus] = useState(fixture?.myStatus ?? null)

  useEffect(() => {
    if (!open || !fixture) return
    setTab('me')
    setMyStatus(fixture.myStatus ?? null)
    if (isAdmin) {
      supabase.from('media_assets').select('id, url').eq('type', 'photo')
        .then(({ data }) => setPhotoAssets(data ?? []))
        .catch(() => {})
    }
  }, [open, fixture, isAdmin])

  // Who's in: reset per fixture (B must never show A's names while it loads),
  // ignore a late answer for a previous fixture, and say so when it fails
  // rather than posing as "Available · 0".
  useEffect(() => {
    if (!open || !fixture) return
    let active = true
    setRows([]); setWhoError(null); setWhoLoading(true)
    Promise.all([
      supabase
        .from('availability')
        .select('status, profile:profiles(id, first_name, last_name, active, approved, is_player)')
        .eq('fixture_id', fixture.id),
      supabase
        .from('team_memberships')
        .select('profiles!inner(id, active, approved, is_player)')
        .eq('team_id', fixture.team_id),
    ])
      .then(([availRes, rosterRes]) => {
        if (!active) return
        const error = availRes.error ?? rosterRes.error
        if (error) throw error
        // Same squad definition as the hero counts and the Who's In sheet
        // (squadIds): an answer from someone no longer in THIS squad is left
        // off, so every reader of this fixture agrees on who counts.
        const squad = squadIds(rosterRes.data)
        setRows((availRes.data ?? []).filter((r) => r.profile && squad.has(r.profile.id)))
        setWhoLoading(false)
      })
      .catch((err) => {
        if (!active) return
        logError('fetch', err, { where: 'FixtureDetail.whosIn', fixtureId: fixture.id })
        setWhoError(friendlyError(err, "Couldn't load who's in — check your signal and try again."))
        setWhoLoading(false)
      })
    return () => { active = false }
  }, [open, fixture, whoAttempt])

  if (!fixture) return null
  const f = fixture
  const isXL = f.team?.key === 'xl'
  const grad = isXL ? 'var(--grad-xl)' : 'var(--grad-community)'

  async function pin(mediaId) {
    const { error } = await setPinnedImage(f.id, f.pinned_image_id === mediaId ? null : mediaId)
    if (error) {
      logError('write', error, { where: 'FixtureDetail.pin', fixtureId: f.id })
      setToast(friendlyError(error, "Couldn't pin that photo — give it another go."))
      return
    }
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
      <Toast message={toast} onDismiss={() => setToast(null)} />
      <div className="det-hero" style={{ backgroundImage: heroBackground({ pinnedUrl: f.pinnedUrl, pool, seed: f.id, gradient: grad }), backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <span className="kicker" style={{ color: 'rgba(255,255,255,.85)' }}>{teamMatchName(f.team)}{f.team?.is_first_team ? ' · First Team' : ''} · {f.home_away} · {f.fixture_type}</span>
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

      {/* A view switch, so it gets the underline bar — not three brand-red
          buttons sitting directly under the sheet's actual action. */}
      <div className="mt-4">
        <TabBar
          id="fixture-detail"
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'me', label: 'Availability' },
            { key: 'who', label: "Who's in" },
            { key: 'line', label: 'Line-up' },
          ]}
        />
      </div>

      {tab === 'line' ? (
        <LineupBoard fixture={f} isAdmin={isAdmin} open={open} />
      ) : tab === 'me' ? (
        <div className="mt-4">
          {!blockReason
            ? <AvailControl value={myStatus} onChange={async (s) => {
                const prev = myStatus
                setMyStatus(s) // optimistic — reflect the pick immediately
                // onSetAvail resolves false (rather than throwing) when the
                // write failed after retrying — put the old pick back, and
                // pass the verdict on so the control doesn't say "Saved ✓".
                try { const ok = await onSetAvail(s); if (ok === false) setMyStatus(prev); return ok }
                catch { setMyStatus(prev); return false }
              }} />
            : <p className="muted" style={{ fontSize: 14 }}>{respondBlockCopy(blockReason, f)}</p>}

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
          {whoError ? (
            <>
              <p className="field-error" role="alert">{whoError}</p>
              <button className="btn btn-ghost btn-block" onClick={() => setWhoAttempt((n) => n + 1)}>Try again</button>
            </>
          ) : whoLoading ? (
            <p className="muted center" style={{ fontSize: 14 }}>Counting heads…</p>
          ) : (
            <>
              <WhoGroup title="Available" colour="var(--green-bright)" rows={group('in')} name={name} isMe={isMe} />
              <WhoGroup title="Maybe" colour="var(--amber)" rows={group('maybe')} name={name} isMe={isMe} />
              <WhoGroup title="Can't make it" colour="var(--red-bright)" rows={group('out')} name={name} isMe={isMe} />
              <p className="muted center" style={{ fontSize: 14 }}>{f.noReply} not replied yet</p>
            </>
          )}
        </div>
      )}

      <style>{`
        .det-hero { border-radius: var(--r-hero); padding: 16px; position: relative; }
        .det-edit { position: absolute; top: 14px; right: 14px; padding: 5px 12px; font-size: 13px;
          background: rgba(0,0,0,.25); color: #fff; border-color: rgba(255,255,255,.25); }
        .venue-map { width: 100%; height: 200px; border: 1px solid var(--line); border-radius: 12px; display: block; }
        .det-tab { font-size: 14px; padding-left: 8px; padding-right: 8px; }
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
