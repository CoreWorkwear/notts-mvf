/* Web-push handlers imported by the generated Workbox service worker. */

function nonempty(value) {
  return typeof value === 'string' && value.trim() ? value : null
}

function readPayload(message) {
  let payload
  try {
    payload = message?.json()
  } catch {
    try { payload = message?.text() } catch { /* A bodyless push still opens the club. */ }
  }
  if (typeof payload === 'string') return { body: payload }
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
}

function destination(data) {
  return safePath(data?.url) || safePath(data?.data?.url) || safePath(data)
}

// Direct Web Push senders can also supply an absolute URL for this exact app
// origin. Older admin payloads use root-relative paths on every deployment.
function imagePath(value) {
  if (typeof value !== 'string') return null
  const origin = self.location.origin
  const relative = value.startsWith(origin + '/') ? value.slice(origin.length) : value
  const path = safePath(relative)
  return path && /\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/i.test(path.split(/[?#]/)[0]) ? path : null
}

function fixturePath(fixtureId) {
  return '/fixtures?' + new URLSearchParams({ mvf_fixture: fixtureId })
}

function trayActions(data, kind, fixtureId) {
  if (kind === 'training') return []
  const max = self.Notification?.maxActions
  let actions = []
  if (fixtureId && kind === 'avail') {
    actions = [{ action: 'in', title: "I'm in" }, { action: 'out', title: "Can't make it" }]
    if (max >= 3) actions.push({ action: 'maybe', title: 'Maybe' })
  } else {
    for (const item of Array.isArray(data.actions) ? data.actions : []) {
      if (!nonempty(item?.action) || !nonempty(item.title)) continue
      const icon = imagePath(item.icon)
      actions.push({ action: item.action, title: item.title, ...(icon ? { icon } : {}) })
    }
    if (fixtureId && !actions.length) {
      actions.push({ action: 'lineup', title: 'View line-up' })
      if (kind === 'match') actions.push({ action: 'availability', title: 'Confirm availability' })
    }
  }
  return Number.isInteger(max) && max >= 0 ? actions.slice(0, max) : actions
}

async function windowClients(includeUncontrolled = false) {
  try { return await self.clients.matchAll({ type: 'window', includeUncontrolled }) || [] }
  catch { return [] }
}

self.addEventListener('push', (event) => {
  const data = readPayload(event.data)
  const title = nonempty(data.title) || 'Nottinghamshire MvF'
  const body = typeof data.body === 'string' ? data.body : ''
  const link = destination(data)
  const parsed = link && new URL(link, self.location.origin)
  // Training notices and cancellations link to their session. A stale fixture
  // field or custom action can never turn a training tap into an RSVP write.
  const training = data.kind === 'training' || parsed?.pathname === '/training'
  const fixtureId = training ? null : nonempty(data.fixtureId)
  const teamKey = ['xl', 'community'].includes(data.teamKey) ? data.teamKey : null
  const legacyLineup = parsed?.pathname === '/fixtures' && parsed.searchParams.get('view') === 'lineup'
  let kind = fixtureId ? 'match' : 'news'
  if (training) kind = 'training'
  else if (fixtureId && (data.withAvailability === true || data.withAvailability === 'true')) kind = 'avail'
  else if (data.kind === 'lineup' || legacyLineup) kind = 'lineup'
  const url = kind === 'lineup' && fixtureId ? fixturePath(fixtureId) + '&view=lineup' : link || (training ? '/training' : '/')
  const target = fixtureId && (url === '/' || url === '/fixtures') ? fixturePath(fixtureId) : url
  const actions = trayActions(data, kind, fixtureId)
  const tag = nonempty(data.tag) || (fixtureId ? kind + '-' + fixtureId : undefined)
  event.waitUntil((async () => {
    const windows = await windowClients()
    const visible = windows.filter(c => c?.visibilityState === 'visible' && typeof c.postMessage === 'function')
    const foreground = visible.find(c => c.focused) || visible[0]
    const options = {
      body, data: { url, fixtureId },
      icon: imagePath(data.icon) || (teamKey ? '/push-' + teamKey + '.png' : '/pwa-192x192.png'),
      badge: imagePath(data.badge) || '/push-badge.png',
      tag, actions,
      // A background training change keeps its deployed re-alert behaviour.
      renotify: !!tag && !foreground && ['avail', 'match', 'training'].includes(kind),
      ...(foreground ? { silent: true } : {}),
    }
    // A userVisibleOnly subscription always gets a system notification. Some
    // implementations reject optional NotificationOptions instead of ignoring them.
    try {
      await self.registration.showNotification(title, options)
    } catch (error) {
      if (!['TypeError', 'NotSupportedError'].includes(error?.name)) throw error
      await self.registration.showNotification(title, { body, data: options.data })
    }
    try { foreground?.postMessage({ type: 'mvf-foreground', title, body, teamKey, url: target, kind }) }
    catch { /* The page may have closed. The notification is already in the tray. */ }
  })())
})

// The app upserts a rotated subscription at its next open. Some browsers
// supply a replacement themselves or expose subscription changes without a key.
self.addEventListener('pushsubscriptionchange', (event) => {
  if (event.newSubscription) return
  const key = event.oldSubscription?.options?.applicationServerKey
  if (!key || !self.registration.pushManager?.subscribe) return
  event.waitUntil((async () => {
    try { await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) }
    catch { /* syncPush retries when the signed-in player next opens the app. */ }
  })())
})

// Is this deep link one of OUR paths? A push payload's `url` is data, not a
// destination we trust: clients.openWindow() will happily open any absolute URL,
// so an off-origin value here turns a club notification into a tap-to-visit link
// for somewhere else. `startsWith('/')` is not enough — browsers normalise a
// backslash to '/', so `/\evil.com` parses as `//evil.com` and leaves the app.
//
// Same rules as safeAppPath() in src/lib/navigation.js, restated because a
// service worker is a plain script and cannot import the module.
// src/sw/push-sw.test.js pins the two to the same behaviour.
function safePath(url) {
  if (typeof url !== 'string' || url === '') return null
  // Both hazards are code points, checked here rather than with a regex so
  // neither has to appear literally in this file:
  //   92         backslash - the URL parser turns it into "/", so a path like
  //              "/\\evil.com" becomes "//evil.com" and leaves the app.
  //              That is CVE-2025-68470's bypass of the startsWith check.
  //   <0x20 0x7f control characters - the parser STRIPS these, letting what
  //              is left reassemble into a different URL entirely.
  for (var i = 0; i < url.length; i++) {
    var code = url.charCodeAt(i)
    if (code === 92 || code < 0x20 || code === 0x7f) return null
  }
  if (url.charAt(0) !== '/' || url.slice(0, 2) === '//') return null
  try {
    var resolved = new URL(url, self.location.origin)
    if (resolved.origin !== self.location.origin || resolved.pathname.startsWith('//')) return null
    return resolved.pathname + resolved.search + resolved.hash
  } catch (e) {
    return null
  }
}

// A cold-opened one-tap answer must not be a forgeable link. The window is
// opened at `?mvf_action=<nonce>`; the nonce is random, lives only in this
// browser's Cache Storage for a few minutes, and maps to the {fixtureId,
// status} the player actually tapped. PushActions looks it up, applies it
// once, and deletes it - so a hand-built URL (a link in a message, a QR
// code) can never write anyone's availability. src/lib/pushAction.js reads
// the other side; keep the cache name and key prefix in step with it.
var ACTION_CACHE = 'mvf-actions'
var ACTION_PREFIX = '/__mvf_action/'
var ACTION_TTL_MS = 10 * 60 * 1000

function newNonce() {
  var bytes = new Uint8Array(16)
  self.crypto.getRandomValues(bytes)
  var out = ''
  for (var i = 0; i < bytes.length; i++) out += ('0' + bytes[i].toString(16)).slice(-2)
  return out
}

function stashAction(fixtureId, status) {
  var nonce = newNonce()
  var body = JSON.stringify({ fixtureId: fixtureId, status: status, expiresAt: Date.now() + ACTION_TTL_MS })
  return self.caches.open(ACTION_CACHE).then(function (cache) {
    return cache.put(ACTION_PREFIX + nonce, new Response(body, { headers: { 'content-type': 'application/json' } }))
  }).then(function () { return nonce })
}

self.addEventListener('notificationclick', (event) => {
  event.notification?.close?.()
  const data = event.notification?.data
  const path = destination(data) || (data?.kind === 'training' ? '/training' : '/')
  const training = data?.kind === 'training' || new URL(path, self.location.origin).pathname === '/training'
  const fixtureId = training ? null : nonempty(data?.fixtureId)
  const action = event.action
  const answer = fixtureId && ['in', 'maybe', 'out'].includes(action)
  let url = path
  if (fixtureId && (answer || action === 'lineup' || action === 'availability' || path === '/fixtures' || path === '/')) {
    url = fixturePath(fixtureId)
    if (action === 'lineup') url += '&view=lineup'
  }

  event.waitUntil((async () => {
    const windows = await windowClients(true)
    const message = answer ? { type: 'mvf-avail', fixtureId, status: action } : { type: 'mvf-navigate', url }
    for (const client of windows) {
      if (typeof client?.focus !== 'function' || typeof client.postMessage !== 'function') continue
      try {
        await client.focus()
        client.postMessage(message)
        return
      } catch { /* The window closed or navigated while the player tapped. */ }
    }
    if (answer) {
      try { url = '/fixtures?mvf_action=' + await stashAction(fixtureId, action) }
      catch { /* Storage unavailable: open the addressed fixture for a manual answer. */ }
    }
    const existing = windows.find(client => typeof client?.navigate === 'function')
    if (typeof self.clients.openWindow === 'function') {
      try { return await self.clients.openWindow(url) }
      catch (error) { if (!existing) throw error }
    }
    if (existing) return existing.navigate(url)
    throw new Error('Unable to open the notification destination')
  })())
})
