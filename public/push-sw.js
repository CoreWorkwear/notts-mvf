/* Web-push handlers, imported into the generated service worker (vite-plugin-pwa
   workbox.importScripts). Plain SW code — no modules. */

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) { data = { body: event.data && event.data.text() } }

  const title = data.title || 'Nottinghamshire MvF'
  const training = data.kind === 'training'
  const fixtureId = training ? null : (data.fixtureId || null)
  // Keep the two decisive answers first on platforms with two tray buttons.
  // Where three fit, Maybe is one tap too. The body always opens the fixture.
  const actions = data.withAvailability && fixtureId
    ? [
        { action: 'in', title: "I'm in" },
        { action: 'out', title: "Can't make it" },
      ]
    : (training ? [] : (data.actions || []))
  if (data.withAvailability && fixtureId && self.Notification?.maxActions >= 3) {
    actions.push({ action: 'maybe', title: 'Maybe' })
  }

  // Tag per KIND per fixture: an availability nudge and a match reminder for
  // the same game must not replace each other (the default offsets collide at
  // 72h). renotify keeps a replacement audible — without it a same-tag re-push
  // swaps the tray card with no sound or vibration and nobody notices.
  const kind = data.withAvailability ? 'avail' : 'match'
  const tag = data.tag || (fixtureId ? kind + '-' + fixtureId : undefined)

  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag,
      renotify: !!tag,
      data: { url: data.url || '/', fixtureId },
      actions,
    })
  )
})

// The browser can rotate or expire a push subscription at any time. Without
// this handler that death is silent: the server's next send 404/410s, the
// token row is pruned, and the player never gets a reminder again. Re-cover
// delivery here with the same key; the app upserts the fresh subscription to
// push_tokens on its next open (syncPush in src/lib/push.js).
self.addEventListener('pushsubscriptionchange', (event) => {
  // Some browsers hand us the replacement already made — nothing to do but
  // let the app store it on its next open. Without an old key we can't
  // re-subscribe here at all (the VAPID key lives in the app), so the same
  // app-open heal covers that case too.
  if (event.newSubscription) return
  const key = event.oldSubscription && event.oldSubscription.options &&
    event.oldSubscription.options.applicationServerKey
  if (!key) return
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).catch(function () {})
  )
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
    if (resolved.origin !== self.location.origin) return null
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
  event.notification.close()
  const d = event.notification.data || {}
  const action = event.action // '', 'in', 'maybe', 'out'
  const avail = ['in', 'maybe', 'out'].includes(action) ? action : null
  // Anything we can't vouch for falls back to the app root, so a tap still
  // opens the club rather than doing nothing (or going somewhere else).
  let url = safePath(d.url) || '/'
  const answering = !!(avail && d.fixtureId)
  if (d.fixtureId && (url === '/fixtures' || url === '/')) url = '/fixtures?mvf_fixture=' + encodeURIComponent(d.fixtureId)

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          // App is open — tell it to apply the availability without a reload,
          // or to move to the deep link (news / line-up): focusing alone left
          // the player on whatever screen happened to be up.
          if (answering) c.postMessage({ type: 'mvf-avail', fixtureId: d.fixtureId, status: avail })
          else c.postMessage({ type: 'mvf-navigate', url })
          return c.focus()
        }
      }
      if (!answering) return self.clients.openWindow(url)
      // If the nonce can't be stored the tap is lost, but the app still opens
      // on the fixtures - never a fallback to a forgeable URL.
      return stashAction(d.fixtureId, avail)
        .then((nonce) => self.clients.openWindow('/fixtures?mvf_action=' + nonce))
        .catch(() => self.clients.openWindow('/fixtures'))
    })
  )
})
