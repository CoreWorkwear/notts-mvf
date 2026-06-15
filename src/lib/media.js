// Pure media helpers (no DOM/network) so they're unit-testable.

// Small deterministic string hash — used to pick a stable photo per fixture so
// the poster hero doesn't flicker to a different photo on every render.
export function hashString(s) {
  let h = 0
  const str = String(s ?? '')
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

// Choose the poster-hero background: a pinned photo if set, otherwise a
// stable pseudo-random pick from the club pool (seeded by the fixture id),
// else null (callers fall back to the team-colour gradient).
export function pickHeroImage({ pinnedUrl = null, pool = [], seed = '' } = {}) {
  if (pinnedUrl) return pinnedUrl
  if (!pool || pool.length === 0) return null
  return pool[hashString(seed) % pool.length]
}

// CSS background-image for a poster hero: the chosen photo under the dark wash,
// or the team gradient under the wash when there's no photo. The wash always
// stays on top so white display type reads (DESIGN-SYSTEM §1).
export function heroBackground({ pinnedUrl = null, pool = [], seed = '', gradient } = {}) {
  const img = pickHeroImage({ pinnedUrl, pool, seed })
  return img ? `var(--hero-wash), url("${img}")` : `var(--hero-wash), ${gradient}`
}
