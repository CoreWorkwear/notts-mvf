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

export default function WeatherStrip({ fixture, light = false, detailed = false }) {
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
  return (
    <span className={'wx' + (light ? ' wx-light' : '') + (detailed ? ' wx-detailed' : '')} title={wx.text}>
      <WeatherIcon category={wx.category} size={detailed ? 30 : 20} />
      {temp != null && <span className="wx-temp mono">{detailed ? 'Feels ' : ''}{temp}°</span>}
      {detailed && wx.wind != null && <span className="wx-bit mono">💨 {wx.wind}mph</span>}
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
