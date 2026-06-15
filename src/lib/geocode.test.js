import { describe, test, expect, vi, afterEach } from 'vitest'
import { normalizePostcode, geocodePostcode } from './geocode'

describe('normalizePostcode', () => {
  test('uppercases and spaces the inward code', () => {
    expect(normalizePostcode('ng184yd')).toBe('NG18 4YD')
    expect(normalizePostcode('  ng18 4yd ')).toBe('NG18 4YD')
    expect(normalizePostcode('m11ae')).toBe('M1 1AE')
  })
  test('leaves implausible input alone', () => {
    expect(normalizePostcode('')).toBe('')
    expect(normalizePostcode('ABC')).toBe('ABC')
  })
})

describe('geocodePostcode', () => {
  afterEach(() => vi.restoreAllMocks())

  test('returns lat/lng on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ result: { latitude: 52.9, longitude: -1.1 } }) })))
    expect(await geocodePostcode('NG18 4YD')).toEqual({ lat: 52.9, lng: -1.1 })
  })
  test('returns null for an unknown postcode (404)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    expect(await geocodePostcode('ZZ1 1ZZ')).toBeNull()
  })
  test('returns null on a network error, and skips the lookup when empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await geocodePostcode('NG1 1AA')).toBeNull()
    expect(await geocodePostcode('')).toBeNull()
  })
})
