// Is this a deep link we're willing to follow inside our own app?
//
// Push payloads carry a `url` (send-push's body, or a reminder's) that both the
// service worker and the router act on. "Starts with / and not //" is NOT
// enough: browsers normalise a backslash to a forward slash while parsing a
// URL, so `/\evil.com` becomes `//evil.com` — a protocol-relative link straight
// off-site. That is the bypass behind CVE-2025-68470 in react-router, and it
// reached us through the same string-prefix check.
//
// Returns the safe same-origin path (+ query + hash) or null. Fails closed:
// anything unparseable, absolute, or on another origin is null.
//
// public/push-sw.js keeps its own copy of these rules — it is plain
// service-worker script and cannot import a module. src/sw/push-sw.test.js
// pins the two to the same behaviour.
export function safeAppPath(url, origin = globalThis.location?.origin) {
  if (typeof url !== 'string' || url === '') return null
  // Both hazards are code points, checked here rather than with a regex so
  // neither has to appear literally in this file:
  //   92         backslash - the URL parser turns it into "/", so a path like
  //              "/\\evil.com" becomes "//evil.com" and leaves the app.
  //              That is CVE-2025-68470's bypass of the startsWith check.
  //   <0x20 0x7f control characters - the parser STRIPS these, letting what
  //              is left reassemble into a different URL entirely.
  for (let i = 0; i < url.length; i++) {
    const code = url.charCodeAt(i)
    if (code === 92 || code < 0x20 || code === 0x7f) return null
  }
  if (!url.startsWith('/') || url.startsWith('//')) return null
  if (!origin) return null
  try {
    const resolved = new URL(url, origin)
    if (resolved.origin !== origin) return null
    return resolved.pathname + resolved.search + resolved.hash
  } catch {
    return null
  }
}
