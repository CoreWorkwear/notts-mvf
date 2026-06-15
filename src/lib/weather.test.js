import { describe, test, expect } from 'vitest'
import { inForecastWindow, weatherLabel, parseDailyForecast, FORECAST_DAYS } from './weather'
import { todayISO } from './format'

function plusDays(n) {
  const [y, m, d] = todayISO().split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

describe('inForecastWindow', () => {
  test('today and within the window are in', () => {
    expect(inForecastWindow(todayISO())).toBe(true)
    expect(inForecastWindow(plusDays(FORECAST_DAYS))).toBe(true)
  })
  test('past games and far-future games are out', () => {
    expect(inForecastWindow(plusDays(-1))).toBe(false)
    expect(inForecastWindow(plusDays(FORECAST_DAYS + 1))).toBe(false)
  })
})

describe('weatherLabel', () => {
  test('maps known WMO codes', () => {
    expect(weatherLabel(0).text).toBe('Clear')
    expect(weatherLabel(61).text).toBe('Rain')
    expect(weatherLabel(95).text).toBe('Thunderstorm')
  })
  test('falls back for unknown codes', () => {
    expect(weatherLabel(999).icon).toBe('🌡')
  })
})

describe('parseDailyForecast', () => {
  const json = {
    daily: {
      time: ['2026-03-07', '2026-03-08'],
      weather_code: [3, 61],
      temperature_2m_max: [9.4, 7.8],
      precipitation_probability_max: [20, 80],
    },
  }
  test('pulls the matching day and rounds the temp', () => {
    expect(parseDailyForecast(json, '2026-03-08')).toMatchObject({ code: 61, tempMax: 8, precip: 80, text: 'Rain' })
  })
  test('returns null when the date is not in the response', () => {
    expect(parseDailyForecast(json, '2026-03-09')).toBeNull()
    expect(parseDailyForecast({}, '2026-03-08')).toBeNull()
  })
})
