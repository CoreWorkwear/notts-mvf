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
  return img ? `var(--hero-wash), url("${cssUrl(img)}")` : `var(--hero-wash), ${gradient}`
}

// Make a URL safe to drop inside a CSS url("…"). The value comes from a
// database column an admin typed, and a bare quote-and-paren in it would
// close the url() and let the rest be read as further CSS declarations — not
// script execution, but enough to repaint the hero or beacon out to another
// origin. The DB constraints (migrations 0035 F6 / 0037 D) and the CSP
// img-src rule are the other two layers.
//
// Percent-encoded by code point, NOT with encodeURIComponent: that function
// deliberately leaves ' ( ) unescaped, which is three of the five characters
// that matter here. Only the literal-ending characters are touched — ':' and
// '/' have to survive or every https:// URL breaks.
const CSS_URL_UNSAFE = new Set([String.fromCharCode(34), String.fromCharCode(39), "(", ")", String.fromCharCode(92)])
export function cssUrl(url) {
  let out = ""
  for (const ch of String(url ?? "")) {
    const code = ch.charCodeAt(0)
    out += (CSS_URL_UNSAFE.has(ch) || code <= 0x20 || code === 0x7f)
      ? "%" + code.toString(16).padStart(2, "0").toUpperCase()
      : ch
  }
  return out
}
