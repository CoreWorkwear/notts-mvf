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
  const key = event.oldSubscription && event.oldSubscription.options &&
    event.oldSubscription.options.applicationServerKey
  if (!key) return
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).catch(function () {})
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const d = event.notification.data || {}
  const action = event.action // '', 'in', 'maybe', 'out'
  const avail = ['in', 'maybe', 'out'].includes(action) ? action : null
  let url = d.url || '/'
  if (avail && d.fixtureId) url = `/fixtures?mvf_fixture=${d.fixtureId}&mvf_avail=${avail}`

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          // App is open — tell it to apply the availability without a reload.
          if (avail && d.fixtureId) c.postMessage({ type: 'mvf-avail', fixtureId: d.fixtureId, status: avail })
          return c.focus()
        }
      }
      return self.clients.openWindow(url)
    })
  )
})
