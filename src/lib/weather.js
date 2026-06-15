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

// WMO weather code → icon + short label + drawing category (for the animated icon).
const WMO = [
  [[0], '☀️', 'Clear', 'clear'],
  [[1], '🌤', 'Mainly clear', 'partly'],
  [[2], '⛅', 'Partly cloudy', 'partly'],
  [[3], '☁️', 'Overcast', 'cloud'],
  [[45, 48], '🌫', 'Fog', 'fog'],
  [[51, 53, 55, 56, 57], '🌦', 'Drizzle', 'rain'],
  [[61, 63, 65, 66, 67], '🌧', 'Rain', 'rain'],
  [[71, 73, 75, 77], '🌨', 'Snow', 'snow'],
  [[80, 81, 82], '🌧', 'Showers', 'rain'],
  [[85, 86], '🌨', 'Snow showers', 'snow'],
  [[95, 96, 99], '⛈', 'Thunderstorm', 'storm'],
]
export function weatherLabel(code) {
  for (const [codes, icon, text] of WMO) if (codes.includes(code)) return { icon, text }
  return { icon: '🌡', text: 'Forecast' }
}
export function weatherCategory(code) {
  for (const [codes, , , cat] of WMO) if (codes.includes(code)) return cat
  return 'cloud'
}

// One-line club-voice read of the conditions: am I freezing, sweating, getting
// wet, or blown off the pitch? Priority order matters.
export function weatherVerdict({ feelsLike, precip, wind, category } = {}) {
  if (category === 'storm') return "Storm's brewing"
  if (category === 'snow') return 'Snow on the way'
  if (precip >= 60) return 'Bring a brolly'
  if (feelsLike != null && feelsLike <= 2) return 'Freezing — wrap up'
  if (feelsLike != null && feelsLike >= 25) return 'Scorcher — bring water'
  if (wind != null && wind >= 24) return 'Proper blustery'
  if (feelsLike != null && feelsLike <= 8) return 'Bit nippy'
  if (precip >= 35) return 'Could get wet'
  if (wind != null && wind >= 16) return 'Bit breezy'
  return 'Grand for it'
}

// Pull the single day's numbers out of an Open-Meteo daily response.
export function parseDailyForecast(json, dateISO) {
  const t = json?.daily?.time
  if (!Array.isArray(t)) return null
  const i = t.indexOf(dateISO)
  if (i < 0) return null
  const d = json.daily
  const code = d.weather_code?.[i]
  const tempMax = d.temperature_2m_max?.[i]
  const feels = d.apparent_temperature_max?.[i]
  const precip = d.precipitation_probability_max?.[i]
  const wind = d.wind_speed_10m_max?.[i]
  if (tempMax == null && code == null) return null
  const r = (v) => (v == null ? null : Math.round(v))
  const data = {
    code,
    category: weatherCategory(code),
    tempMax: r(tempMax),
    feelsLike: r(feels),
    precip: r(precip),
    wind: r(wind),
    ...weatherLabel(code),
  }
  data.verdict = weatherVerdict(data)
  return data
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
    `&daily=weather_code,temperature_2m_max,apparent_temperature_max,precipitation_probability_max,wind_speed_10m_max` +
    `&wind_speed_unit=mph&timezone=Europe%2FLondon&start_date=${dateISO}&end_date=${dateISO}`
  const r = await fetch(url)
  const j = await r.json()
  return parseDailyForecast(j, dateISO)
}
