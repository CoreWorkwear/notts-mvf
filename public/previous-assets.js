// Workbox removes obsolete hashed modules from its precache on activation.
// Hold one previous set for tabs still running that shell. Capture it during
// install, while the active worker and its complete cache are still available.
self.addEventListener('install', event => {
  if (!self.registration.active) return
  event.waitUntil(keepPreviousAssets().catch(() => {
    // Storage may be restricted. The ordinary Workbox install and the
    // page's one-shot stale chunk recovery can still run independently.
  }))
})

async function keepPreviousAssets() {
  const precache = 'workbox-precache-v2-' + self.registration.scope
  if (!(await caches.keys()).includes(precache)) return
  const current = await caches.open(precache)
  const keys = (await current.keys()).filter(key => {
    const url = new URL(key.url)
    return url.origin === self.location.origin && /^\/assets\/[^/]+-[\w-]{8,}\.(js|css)$/.test(url.pathname)
  })
  const previous = await caches.open('mvf-previous-assets')
  const keep = new Set(keys.map(key => key.url))
  for (const old of await previous.keys()) if (!keep.has(old.url)) await previous.delete(old)
  for (const key of keys) {
    if (await previous.match(key)) continue
    const response = await current.match(key)
    if (response) await previous.put(key, response)
  }
}
