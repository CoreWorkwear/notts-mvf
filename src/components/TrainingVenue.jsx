import { useState } from 'react'
import { directionsUrl, mapSearchUrl, osmEmbedUrl } from '../lib/maps'
import WeatherStrip from './WeatherStrip'
import '../styles/training-venue.css'

function venuePoint(session) {
  const address = [session.venue, session.address, session.town, session.postcode].filter(Boolean).join(', ')
  return { lat: session.venue_lat, lng: session.venue_lng, address }
}

function Forecast({ session, card }) {
  if (session.cancelled) return null
  return <WeatherStrip training card={card} fixture={{
    id: session.id, match_date: session.start_date, kickoff: session.start_time,
    venue_lat: session.venue_lat, venue_lng: session.venue_lng,
  }} />
}

export function TrainingSessionCard({ session, audience, status, onOpen }) {
  const route = directionsUrl(venuePoint(session))
  return <article className="training-session-card">
    <button type="button" className="training-session" onClick={onOpen}>
      <time className="training-session-time" dateTime={`${session.start_date}T${session.start_time}`}>{session.start_time.slice(0, 5)}</time>
      <span><strong>{audience}</strong><span>{session.venue}, {session.town}</span>
        {session.postcode && <span className="mono">{session.postcode}</span>}<span>{status}</span></span>
    </button>
    <div className="training-session-tools">
      {route && <a className="training-direction" href={route} target="_blank" rel="noreferrer">Get directions</a>}
      <Forecast session={session} />
    </div>
  </article>
}

export function TrainingVenueDetails({ session }) {
  const [expanded, setExpanded] = useState(false)
  const point = venuePoint(session)
  const embed = osmEmbedUrl(point.lat, point.lng)
  const directions = directionsUrl(point)
  const maps = mapSearchUrl(point)
  const words = session.w3w?.replace(/^\/+/, '')
  return <section className="training-venue-details" aria-label="Training venue">
    <p>{session.venue}, {session.town}</p>
    {(session.address || session.postcode) && <p>{session.address}{session.address && session.postcode && ', '}<span className="mono">{session.postcode}</span></p>}
    <div className="training-venue-links">
      {directions && <a className="training-direction" href={directions} target="_blank" rel="noreferrer">Get directions</a>}
      {maps && <a className="training-direction" href={maps} target="_blank" rel="noreferrer">Open in Maps</a>}
      {words && <a className="training-direction mono" href={`https://what3words.com/${encodeURIComponent(words)}`} target="_blank" rel="noreferrer">{`///${words}`}</a>}
    </div>
    {embed && <details onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>Venue map</summary>
      {expanded && <iframe src={embed} title={`Map of ${session.venue}`} loading="lazy" />}
    </details>}
    <Forecast session={session} card />
  </section>
}
