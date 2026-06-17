import { describe, test, expect } from 'vitest'
import { venueCoords } from './WeatherStrip'

// The band must only ever show the VENUE's own weather — never a city fallback —
// so an away/TBC game with no coords shows nothing rather than the wrong place.
describe('venueCoords — no silent location fallback', () => {
  test('returns the venue coordinates when both are set', () => {
    expect(venueCoords({ venue_lat: 53.1145, venue_lng: -1.1196 })).toEqual({ lat: 53.1145, lng: -1.1196 })
  })
  test('returns null when coordinates are missing (so the band hides)', () => {
    expect(venueCoords({ venue_lat: null, venue_lng: null })).toBeNull()
    expect(venueCoords({ venue_lat: 53.1, venue_lng: null })).toBeNull()
    expect(venueCoords({})).toBeNull()
    expect(venueCoords(null)).toBeNull()
  })
})
