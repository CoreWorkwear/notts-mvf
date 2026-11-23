// The page side of a cold-opened notification action. public/push-sw.js stores
// {fixtureId, status, expiresAt} in Cache Storage under a random nonce and
// opens the app at ?mvf_action=<nonce>. Only a nonce the service worker minted
// resolves, so a hand-built link can never write availability. Keep the cache
// name and key prefix in step with the SW.
export const ACTION_CACHE = 'mvf-actions'
export const ACTION_PREFIX = '/__mvf_action/'

const STATUSES = ['in', 'maybe', 'out']

// Look the nonce up, delete it (single use, valid or not), and return
// { fixtureId, status } - or null when it is unknown, expired or malformed.
export async function consumeAction(nonce, now = Date.now()) {
  if (typeof nonce !== 'string' || !/^[0-9a-f]{16,64}$/.test(nonce)) return null
  try {
    if (typeof caches === 'undefined') return null
    const cache = await caches.open(ACTION_CACHE)
    const key = ACTION_PREFIX + nonce
    const hit = await cache.match(key)
    // Two windows can both match. Only the one that removes the record owns it.
    if (!hit || !await cache.delete(key)) return null
    const d = await hit.json()
    if (!d || typeof d.fixtureId !== 'string' || !d.fixtureId.trim() || !STATUSES.includes(d.status)) return null
    if (!Number.isFinite(d.expiresAt) || d.expiresAt <= now) return null
    return { fixtureId: d.fixtureId, status: d.status }
  } catch {
    return null
  }
}
