/* Web-push handlers, imported into the generated service worker (vite-plugin-pwa
   workbox.importScripts). Plain SW code — no modules. */

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) { data = { body: event.data && event.data.text() } }

  const title = data.title || 'Nottinghamshire MvF'
  const fixtureId = data.fixtureId || null
  // Inline actions for an availability nudge (Android; iOS ignores). Chrome
  // renders at most Notification.maxActions = 2 and silently DROPS the rest —
  // three buttons meant "Can't make it" never showed. Keep the two decisive
  // answers; "maybe" is a tap on the notification body (opens the fixture).
  const actions = data.withAvailability && fixtureId
    ? [
        { action: 'in', title: "I'm in" },
        { action: 'out', title: "Can't make it" },
      ]
    : (data.actions || [])

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

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const d = event.notification.data || {}
  const action = event.action // '', 'in', 'maybe', 'out'
  const avail = ['in', 'maybe', 'out'].includes(action) ? action : null
  // Anything we can't vouch for falls back to the app root, so a tap still
  // opens the club rather than doing nothing (or going somewhere else).
  let url = safePath(d.url) || '/'
  if (avail && d.fixtureId) url = `/fixtures?mvf_fixture=${encodeURIComponent(d.fixtureId)}&mvf_avail=${avail}`

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          // App is open — tell it to apply the availability without a reload,
          // or to move to the deep link (news / line-up): focusing alone left
          // the player on whatever screen happened to be up.
          if (avail && d.fixtureId) c.postMessage({ type: 'mvf-avail', fixtureId: d.fixtureId, status: avail })
          else c.postMessage({ type: 'mvf-navigate', url })
          return c.focus()
        }
      }
      return self.clients.openWindow(url)
    })
  )
})
