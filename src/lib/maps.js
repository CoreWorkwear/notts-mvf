// Map + directions URL builders. Keyless: OpenStreetMap for the embed, a
// universal Google Maps directions link that hands off to the device's maps app.

// A small bounding box around a point → OSM's keyless embeddable map, with a
// marker on the venue. delta ~0.004° ≈ a few streets (a tight pitch-level zoom).
export function osmEmbedUrl(lat, lng, delta = 0.004) {
  if (lat == null || lng == null) return null
  const w = (lng - delta).toFixed(5)
  const s = (lat - delta).toFixed(5)
  const e = (lng + delta).toFixed(5)
  const n = (lat + delta).toFixed(5)
  return `https://www.openstreetmap.org/export/embed.html?bbox=${w}%2C${s}%2C${e}%2C${n}&layer=mapnik&marker=${lat}%2C${lng}`
}

// "Get directions" — opens the maps app to a route to the venue. Prefer exact
// coords; otherwise route to the typed address/venue. The universal Google Maps
// URL resolves to Apple/Google Maps on the relevant device.
export function directionsUrl({ lat, lng, address, venue } = {}) {
  if (lat != null && lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat}%2C${lng}`
  }
  const q = (address || venue || '').trim()
  if (!q) return null
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`
}

// A plain "view on map" link (search by coords or address) for when there's no
// embed (e.g. coords missing).
export function mapSearchUrl({ lat, lng, address, venue } = {}) {
  if (lat != null && lng != null) return `https://www.google.com/maps/search/?api=1&query=${lat}%2C${lng}`
  const q = (address || venue || '').trim()
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null
}
