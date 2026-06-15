import { useEffect, useState } from 'react'
import { inForecastWindow, fetchForecast } from '../lib/weather'
import WeatherIcon from './WeatherIcon'

// Small weather strip on a fixture (icon · temp · rain%). Only renders inside
// the forecast window; forecast cached 6h in localStorage.
// Location: the fixture's venue lat/lng when set, otherwise the club city
// (Nottingham). Open-Meteo's geocoder is place-name only, so venue-name lookups
// don't work — venue-precise coords come from venue_lat/lng (populated later).
const TTL = 6 * 60 * 60 * 1000
const CLUB_DEFAULT = { lat: 52.9536, lng: -1.1505 } // Nottingham

function cacheGet(key) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v && Date.now() - v.ts < TTL ? v.data : null } catch { return null }
}
function cacheSet(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })) } catch {}
}

function resolveLatLng(fixture) {
  if (fixture.venue_lat != null && fixture.venue_lng != null) return { lat: fixture.venue_lat, lng: fixture.venue_lng }
  return CLUB_DEFAULT
}

export default function WeatherStrip({ fixture, light = false, detailed = false, card = false }) {
  const [wx, setWx] = useState(null)

  useEffect(() => {
    if (!fixture || !inForecastWindow(fixture.match_date)) { setWx(null); return }
    let active = true
    const key = `wx:${fixture.id}:${fixture.match_date}`
    const cached = cacheGet(key)
    if (cached) { setWx(cached); return }
    ;(async () => {
      try {
        const ll = resolveLatLng(fixture)
        const data = await fetchForecast(ll.lat, ll.lng, fixture.match_date)
        if (!active || !data) return
        cacheSet(key, data)
        setWx(data)
      } catch { /* weather is best-effort */ }
    })()
    return () => { active = false }
  }, [fixture?.id, fixture?.match_date])

  if (!wx) return null
  const temp = wx.feelsLike ?? wx.tempMax

  // Big match-day weather panel (the expanded match-details version).
  if (card) {
    return (
      <div className="wx-card">
        <WeatherIcon category={wx.category} size={56} windy={wx.wind != null && wx.wind >= 16} />
        <div className="wx-card-main">
          <span className="wx-card-text">{wx.text}</span>
          <span className="wx-card-temp display">{(wx.tempMax ?? temp)}°</span>
          {wx.feelsLike != null && <span className="wx-card-feels mono">Feels {wx.feelsLike}°</span>}
        </div>
        <div className="wx-card-bits">
          {wx.wind != null && <span className="wx-card-bit mono">💨 {wx.wind} mph</span>}
          {wx.precip != null && <span className="wx-card-bit mono">💧 {wx.precip}% rain</span>}
        </div>
        {wx.verdict && <p className="wx-card-verdict">{wx.verdict}</p>}
        <style>{`
          .wx-card { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 6px 14px;
            background: var(--coal); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; }
          .wx-card-main { display: flex; flex-direction: column; }
          .wx-card-text { font-size: 13px; color: var(--bone-mute); }
          .wx-card-temp { font-size: 30px; line-height: 1; }
          .wx-card-feels { font-size: 12px; color: var(--bone-dim); margin-top: 2px; }
          .wx-card-bits { display: flex; flex-direction: column; gap: 4px; text-align: right; }
          .wx-card-bit { font-size: 13px; color: var(--bone-mute); white-space: nowrap; }
          .wx-card-verdict { grid-column: 1 / -1; font-family: var(--font-body); font-style: italic;
            color: var(--bone); margin-top: 6px; padding-top: 10px; border-top: 1px solid var(--line); }
        `}</style>
      </div>
    )
  }

  return (
    <span className={'wx' + (light ? ' wx-light' : '') + (detailed ? ' wx-detailed' : '')} title={wx.text}>
      <WeatherIcon category={wx.category} size={detailed ? 30 : 20} windy={wx.wind != null && wx.wind >= 16} />
      {temp != null && <span className="wx-temp mono">{detailed ? 'Feels ' : ''}{temp}°</span>}
      {wx.wind != null && <span className="wx-bit mono">💨 {wx.wind}mph</span>}
      {wx.precip != null && <span className="wx-bit mono">💧 {wx.precip}%</span>}
      {detailed && wx.verdict && <span className="wx-verdict">{wx.verdict}</span>}
      <style>{`
        .wx { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--bone-mute); }
        .wx-light { color: rgba(255,255,255,.92); }
        .wx-detailed { flex-wrap: wrap; gap: 4px 10px; font-size: 13px; }
        .wx-temp { font-weight: 600; }
        .wx-bit { opacity: .9; }
        .wx-verdict { font-family: var(--font-body); font-style: italic; opacity: .95;
          width: 100%; }
        .wx:not(.wx-detailed) .wx-verdict { display: none; }
      `}</style>
    </span>
  )
}
