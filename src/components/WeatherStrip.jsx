import { useEffect, useState } from 'react'
import { inForecastWindow, fetchForecast } from '../lib/weather'
import { fmtKO } from '../lib/format'
import WeatherIcon from './WeatherIcon'

// Small weather strip on a fixture (icon · temp · rain%). Only renders inside
// the forecast window AND only when we know the venue's real coordinates — we
// deliberately DON'T fall back to a default city, so the band never shows the
// wrong place's weather (an away/TBC game with no coords simply shows nothing).
const TTL = 6 * 60 * 60 * 1000

function cacheGet(key) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v && Date.now() - v.ts < TTL ? v.data : null } catch { return null }
}
function cacheSet(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })) } catch {}
}

// The venue's coordinates, or null if unknown. No city fallback — better no
// band than a confidently-wrong one.
export function venueCoords(fixture) {
  if (fixture?.venue_lat != null && fixture?.venue_lng != null) return { lat: fixture.venue_lat, lng: fixture.venue_lng }
  return null
}

export default function WeatherStrip({ fixture, light = false, detailed = false, card = false }) {
  const [wx, setWx] = useState(null)

  useEffect(() => {
    const ll = venueCoords(fixture)
    if (!fixture || !ll || !inForecastWindow(fixture.match_date)) { setWx(null); return }
    let active = true
    // Key includes the kickoff AND the location, so the cached reading is tied
    // to this exact match-hour and venue (a coords change busts a stale entry).
    const key = `wx:${fixture.id}:${fixture.match_date}:${fixture.kickoff ?? ''}:${ll.lat},${ll.lng}`
    const cached = cacheGet(key)
    if (cached) { setWx(cached); return }
    ;(async () => {
      try {
        const data = await fetchForecast(ll.lat, ll.lng, fixture.match_date, fixture.kickoff)
        if (!active || !data) return
        cacheSet(key, data)
        setWx(data)
      } catch { /* weather is best-effort */ }
    })()
    return () => { active = false }
  }, [fixture?.id, fixture?.match_date, fixture?.kickoff, fixture?.venue_lat, fixture?.venue_lng])

  if (!wx) return null
  // Headline the ACTUAL temperature; feels-like is the labelled secondary.
  const actual = wx.tempMax ?? wx.feelsLike
  const feels = wx.feelsLike

  // Big match-day weather panel (the expanded match-details version).
  if (card) {
    return (
      <div className="wx-card">
        <WeatherIcon category={wx.category} size={56} windy={wx.wind != null && wx.wind >= 16} />
        <div className="wx-card-main">
          <span className="wx-card-text">{wx.text}{fixture?.kickoff ? ` · at ${fmtKO(fixture.kickoff)} KO` : ''}</span>
          <span className="wx-card-temp display">{actual}°</span>
          {feels != null && <span className="wx-card-feels mono">Feels like {feels}°</span>}
        </div>
        <div className="wx-card-bits">
          {wx.wind != null && <span className="wx-card-bit mono">💨 {wx.wind} mph</span>}
          {wx.precip != null && <span className="wx-card-bit mono">💧 {wx.precip}% rain</span>}
        </div>
        <style>{`
          .wx-card { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 6px 14px;
            background: var(--coal); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; }
          .wx-card-main { display: flex; flex-direction: column; }
          .wx-card-text { font-size: 13px; color: var(--bone-mute); }
          .wx-card-temp { font-size: 30px; line-height: 1; }
          .wx-card-feels { font-size: 12px; color: var(--bone-dim); margin-top: 2px; }
          .wx-card-bits { display: flex; flex-direction: column; gap: 4px; text-align: right; }
          .wx-card-bit { font-size: 13px; color: var(--bone-mute); white-space: nowrap; }
        `}</style>
      </div>
    )
  }

  return (
    <span className={'wx' + (light ? ' wx-light' : '') + (detailed ? ' wx-detailed' : '')}
      title={`${wx.text}${fixture?.kickoff ? ` at ${fmtKO(fixture.kickoff)} KO` : ''}`}>
      <WeatherIcon category={wx.category} size={detailed ? 30 : 20} windy={wx.wind != null && wx.wind >= 16} />
      {actual != null && <span className="wx-temp mono">{actual}°</span>}
      {detailed && feels != null && feels !== actual && <span className="wx-bit mono">feels {feels}°</span>}
      {wx.wind != null && <span className="wx-bit mono">💨 {wx.wind}mph</span>}
      {wx.precip != null && <span className="wx-bit mono">💧 {wx.precip}%</span>}
      <style>{`
        .wx { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--bone-mute); }
        .wx-light { color: rgba(255,255,255,.92); }
        .wx-detailed { flex-wrap: wrap; gap: 4px 10px; font-size: 13px; }
        .wx-temp { font-weight: 600; }
        .wx-bit { opacity: .9; }
      `}</style>
    </span>
  )
}
