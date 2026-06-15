import { describe, test, expect } from 'vitest'
import { osmEmbedUrl, directionsUrl, mapSearchUrl } from './maps'

describe('osmEmbedUrl', () => {
  test('builds a bbox + marker around the point', () => {
    const u = osmEmbedUrl(52.95, -1.15)
    expect(u).toContain('openstreetmap.org/export/embed.html')
    expect(u).toContain('marker=52.95%2C-1.15')
    expect(u).toContain('bbox=-1.15400%2C52.94600%2C-1.14600%2C52.95400')
  })
  test('null when coords are missing', () => {
    expect(osmEmbedUrl(null, -1.15)).toBeNull()
    expect(osmEmbedUrl(52.95, null)).toBeNull()
  })
})

describe('directionsUrl', () => {
  test('routes to exact coords when present', () => {
    expect(directionsUrl({ lat: 52.95, lng: -1.15 })).toBe('https://www.google.com/maps/dir/?api=1&destination=52.95%2C-1.15')
  })
  test('falls back to the address, then venue', () => {
    expect(directionsUrl({ address: 'Stoke Lane, Gedling' })).toContain('destination=Stoke%20Lane%2C%20Gedling')
    expect(directionsUrl({ venue: 'Forest Rec' })).toContain('destination=Forest%20Rec')
  })
  test('null with nothing to go on', () => {
    expect(directionsUrl({})).toBeNull()
  })
})

describe('mapSearchUrl', () => {
  test('prefers coords, else address', () => {
    expect(mapSearchUrl({ lat: 1, lng: 2 })).toContain('query=1%2C2')
    expect(mapSearchUrl({ venue: 'The Rec' })).toContain('query=The%20Rec')
    expect(mapSearchUrl({})).toBeNull()
  })
})
