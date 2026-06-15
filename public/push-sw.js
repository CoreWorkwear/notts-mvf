/* Web-push handlers, imported into the generated service worker (vite-plugin-pwa
   workbox.importScripts). Plain SW code — no modules. */

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) { data = { body: event.data && event.data.text() } }

  const title = data.title || 'Nottinghamshire MvF'
  const fixtureId = data.fixtureId || null
  // Inline In/Maybe/Out actions for an availability nudge (Android; iOS ignores).
  const actions = data.withAvailability && fixtureId
    ? [
        { action: 'in', title: "I'm in" },
        { action: 'maybe', title: 'Maybe' },
        { action: 'out', title: "Can't make it" },
      ]
    : (data.actions || [])

  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: data.tag || (fixtureId ? 'fixture-' + fixtureId : undefined),
      data: { url: data.url || '/', fixtureId },
      actions,
    })
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
