import { todayISO, parseDate } from './format'

// Weather via Open-Meteo (free, no key, CORS-friendly). MVP fetches client-side
// inside the forecast window and caches in localStorage; the scheduled
// Edge-Function cache to fixtures.forecast is the post-MVP optimisation
// (HANDOVER §12). Pure helpers below are unit-tested; the fetchers are network.

export const FORECAST_DAYS = 14

// Only show weather when the game is in the future and within the window.
export function inForecastWindow(matchDate, today = todayISO()) {
  const diff = Math.round((parseDate(matchDate) - parseDate(today)) / 86400000)
  return diff >= 0 && diff <= FORECAST_DAYS
}

// WMO weather code → icon + short label.
const WMO = [
  [[0], '☀️', 'Clear'],
  [[1], '🌤', 'Mainly clear'],
  [[2], '⛅', 'Partly cloudy'],
  [[3], '☁️', 'Overcast'],
  [[45, 48], '🌫', 'Fog'],
  [[51, 53, 55, 56, 57], '🌦', 'Drizzle'],
  [[61, 63, 65, 66, 67], '🌧', 'Rain'],
  [[71, 73, 75, 77], '🌨', 'Snow'],
  [[80, 81, 82], '🌧', 'Showers'],
  [[85, 86], '🌨', 'Snow showers'],
  [[95, 96, 99], '⛈', 'Thunderstorm'],
]
export function weatherLabel(code) {
  for (const [codes, icon, text] of WMO) if (codes.includes(code)) return { icon, text }
  return { icon: '🌡', text: 'Forecast' }
}

// Pull the single day's numbers out of an Open-Meteo daily response.
export function parseDailyForecast(json, dateISO) {
  const t = json?.daily?.time
  if (!Array.isArray(t)) return null
  const i = t.indexOf(dateISO)
  if (i < 0) return null
  const code = json.daily.weather_code?.[i]
  const tempMax = json.daily.temperature_2m_max?.[i]
  const precip = json.daily.precipitation_probability_max?.[i]
  if (tempMax == null && code == null) return null
  return {
    code,
    tempMax: tempMax == null ? null : Math.round(tempMax),
    precip: precip == null ? null : Math.round(precip),
    ...weatherLabel(code),
  }
}

// --- network ---------------------------------------------------------------

export async function geocode(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&country=GB`
  const r = await fetch(url)
  const j = await r.json()
  const hit = j?.results?.[0]
  return hit ? { lat: hit.latitude, lng: hit.longitude } : null
}

export async function fetchForecast(lat, lng, dateISO) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&daily=weather_code,temperature_2m_max,precipitation_probability_max` +
    `&timezone=Europe%2FLondon&start_date=${dateISO}&end_date=${dateISO}`
  const r = await fetch(url)
  const j = await r.json()
  return parseDailyForecast(j, dateISO)
}
