// UK postcode → coordinates via postcodes.io (free, no API key). Used to set a
// fixture's venue_lat/venue_lng so the weather strip is venue-precise.

// Canonical upper-case form with the single space before the inward code
// (e.g. "ng184yd" → "NG18 4YD"). Display/storage tidiness; lookup is lenient.
export function normalizePostcode(pc) {
  if (!pc) return ''
  const s = String(pc).toUpperCase().replace(/\s+/g, '')
  if (s.length < 5 || s.length > 7) return s // can't place the space confidently
  return s.slice(0, -3) + ' ' + s.slice(-3)
}

// Returns { lat, lng } or null (unknown postcode / offline). Never throws.
export async function geocodePostcode(pc) {
  const clean = String(pc ?? '').trim()
  if (!clean) return null
  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`)
    if (!res.ok) return null
    const json = await res.json()
    const r = json?.result
    if (r && r.latitude != null && r.longitude != null) return { lat: r.latitude, lng: r.longitude }
    return null
  } catch {
    return null
  }
}
