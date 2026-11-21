import { geocodePostcode, normalizePostcode } from './geocode'

export async function resolveVenuePostcode(input, existing) {
  const postcode = normalizePostcode(input) || null
  const unchanged = postcode === (normalizePostcode(existing?.postcode) || null)
  if (unchanged && (!postcode || (existing?.venue_lat != null && existing?.venue_lng != null))) {
    return { postcode, venue_lat: existing?.venue_lat ?? null, venue_lng: existing?.venue_lng ?? null }
  }
  const coords = postcode ? await geocodePostcode(postcode) : null
  return { postcode, venue_lat: coords?.lat ?? null, venue_lng: coords?.lng ?? null }
}
