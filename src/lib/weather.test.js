import { describe, test, expect } from 'vitest'
import { inForecastWindow, weatherLabel, weatherCategory, weatherVerdict, parseDailyForecast, parseHourlyForecast, FORECAST_DAYS } from './weather'
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

describe('weatherCategory', () => {
  test('maps codes to drawing categories', () => {
    expect(weatherCategory(0)).toBe('clear')
    expect(weatherCategory(2)).toBe('partly')
    expect(weatherCategory(61)).toBe('rain')
    expect(weatherCategory(75)).toBe('snow')
    expect(weatherCategory(95)).toBe('storm')
  })
})

describe('weatherVerdict', () => {
  test('storm and snow take priority', () => {
    expect(weatherVerdict({ category: 'storm', feelsLike: 10, precip: 90 })).toMatch(/storm/i)
    expect(weatherVerdict({ category: 'snow', feelsLike: 1 })).toMatch(/snow/i)
  })
  test('reads cold, hot, wet and windy', () => {
    expect(weatherVerdict({ category: 'rain', precip: 80, feelsLike: 10 })).toMatch(/brolly/i)
    expect(weatherVerdict({ category: 'clear', feelsLike: 1 })).toMatch(/freezing/i)
    expect(weatherVerdict({ category: 'clear', feelsLike: 27 })).toMatch(/scorcher/i)
    expect(weatherVerdict({ category: 'cloud', feelsLike: 12, wind: 30 })).toMatch(/blustery/i)
    expect(weatherVerdict({ category: 'clear', feelsLike: 16, wind: 5, precip: 0 })).toMatch(/grand/i)
  })
})

describe('parseDailyForecast', () => {
  const json = {
    daily: {
      time: ['2026-03-07', '2026-03-08'],
      weather_code: [3, 61],
      temperature_2m_max: [9.4, 7.8],
      apparent_temperature_max: [6.6, 4.2],
      precipitation_probability_max: [20, 80],
      wind_speed_10m_max: [12.3, 28.7],
    },
  }
  test('pulls the matching day: temp, feels-like, wind, rain, category, verdict', () => {
    expect(parseDailyForecast(json, '2026-03-08')).toMatchObject({
      code: 61, tempMax: 8, feelsLike: 4, precip: 80, wind: 29, category: 'rain', text: 'Rain', verdict: 'Bring a brolly',
    })
  })
  test('returns null when the date is not in the response', () => {
    expect(parseDailyForecast(json, '2026-03-09')).toBeNull()
    expect(parseDailyForecast({}, '2026-03-08')).toBeNull()
  })
})

describe('parseHourlyForecast — conditions AT kickoff (not the day max)', () => {
  const json = {
    hourly: {
      time: ['2026-03-08T12:00', '2026-03-08T13:00', '2026-03-08T14:00', '2026-03-08T15:00'],
      weather_code: [3, 3, 61, 80],
      temperature_2m: [6.1, 7.0, 8.4, 9.0],
      apparent_temperature: [3.0, 4.0, 5.6, 6.0],
      precipitation_probability: [10, 20, 75, 90],
      wind_speed_10m: [9, 11, 22.4, 25],
    },
  }
  test('picks the row for the kickoff hour', () => {
    expect(parseHourlyForecast(json, '2026-03-08', '14:00:00')).toMatchObject({
      atKickoff: true, code: 61, tempMax: 8, feelsLike: 6, precip: 75, wind: 22, category: 'rain', verdict: 'Bring a brolly',
    })
  })
  test('a different kickoff hour gives different conditions', () => {
    expect(parseHourlyForecast(json, '2026-03-08', '12:00:00')).toMatchObject({ code: 3, tempMax: 6, precip: 10 })
  })
  test('null when the hour is missing or no kickoff given', () => {
    expect(parseHourlyForecast(json, '2026-03-08', '20:00:00')).toBeNull()
    expect(parseHourlyForecast(json, '2026-03-08', null)).toBeNull()
    expect(parseHourlyForecast({}, '2026-03-08', '14:00:00')).toBeNull()
  })
})
