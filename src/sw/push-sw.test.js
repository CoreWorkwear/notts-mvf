import { adminPushPayload } from '../../supabase/functions/_shared/push'
import { availabilityPayload, matchPayload } from '../../supabase/functions/_shared/reminders'
import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest'

// public/push-sw.js is plain service-worker code that registers listeners on
// `self`. Under jsdom `self === window`, so importing it once lets us drive the
// handlers with synthetic events and assert what the notification carries and
// where a tap sends the player.
const clients = { matchAll: vi.fn(), openWindow: vi.fn(() => Promise.resolve()) }
const registration = {
  showNotification: vi.fn(() => Promise.resolve()),
  pushManager: { subscribe: vi.fn(() => Promise.resolve({})), getSubscription: vi.fn(() => Promise.resolve(null)) },
}

const cacheStore = new Map()
beforeAll(async () => {
  self.caches = { open: async () => ({ put: async (k, res) => { cacheStore.set(k, await res.text()) } }) }
  self.clients = clients
  self.registration = registration
  await import('../../public/push-sw.js')
})
beforeEach(() => { vi.clearAllMocks(); clients.matchAll.mockResolvedValue([]) })

// Dispatch an SW-style event: props are spread onto a plain Event, waitUntil
// captures the promise so the test can await the handler's work.
async function fire(type, props) {
  const e = new Event(type)
  let work = Promise.resolve()
  Object.assign(e, { waitUntil: (p) => { work = p }, ...props })
  self.dispatchEvent(e)
  await work
  return e
}

// Built from code points, not escape sequences: a literal backslash or tab
// in a test file is exactly the sort of character a shell, an editor or a
// patch tool quietly eats, and the test would then silently assert that a
// harmless string is rejected. BS is the character the URL parser rewrites
// to '/'; TAB is one it strips.
const BS = String.fromCharCode(92)
const TAB = String.fromCharCode(9)

const windowClient = () => ({ focus: vi.fn(() => Promise.resolve()), postMessage: vi.fn() })

describe('push → notification', () => {

  test('the admin sender carries badge, icon, tag, optional actions and data.url to the OS card', async () => {
    const payload = adminPushPayload({
      title: 'Kit change', body: 'Wear green.', teamKey: 'xl', icon: '/push-community.png', badge: '/favicon.png',
      tag: 'kit-latest', data: { url: '/news?story=kit', unrelated: 'omit' },
      actions: [{ action: 'read', title: 'Read update', icon: '/icon.svg' }],
    }, null)
    expect(payload.url).toBe('/news?story=kit') // Deployed workers read only the top-level field.
    expect(payload.data).toEqual({ url: '/news?story=kit' })
    await fire('push', { data: { json: () => JSON.parse(JSON.stringify(payload)) } })
    expect(registration.showNotification.mock.lastCall[1]).toMatchObject({
      icon: '/push-community.png', badge: '/favicon.png', tag: 'kit-latest', renotify: false,
      actions: [{ action: 'read', title: 'Read update', icon: '/icon.svg' }], data: { url: '/news?story=kit', fixtureId: null },
    })
  })

  test('explicit media is same-origin, including absolute image URLs delivered directly to the worker', async () => {
    await fire('push', { data: { json: () => ({
      icon: self.location.origin + '/push-community.png?v=2', badge: 'https://other.example/something.png',
      actions: [{ action: 'read', title: 'Read', icon: 'https://other.example/mark.svg' }],
    }) } })
    expect(registration.showNotification.mock.lastCall[1]).toMatchObject({
      icon: '/push-community.png?v=2', badge: '/push-badge.png', actions: [{ action: 'read', title: 'Read' }],
    })
    await fire('push', { data: { json: () => ({ icon: '/not-an-image.html', badge: [], teamKey: 'xl' }) } })
    expect(registration.showNotification.mock.lastCall[1]).toMatchObject({ icon: '/push-xl.png', badge: '/push-badge.png' })
  })

  test('an old admin send keeps defaults, fixture targeting stays separate from presentation fields', () => {
    expect(JSON.parse(JSON.stringify(adminPushPayload({}, null)))).toEqual({
      title: 'Nottinghamshire MvF', body: '', fixtureId: null, withAvailability: false, url: '/fixtures',
    })
    const payload = adminPushPayload({
      fixtureId: 'unvalidated', profileIds: ['private'], teamKey: 'blue', withAvailability: true,
      tag: [], badge: {}, icon: 'https://other.example/p.png', actions: [null, { action: 'read' }],
      url: '/news', data: { url: '/training', fixtureId: 'another' },
    }, 'validated')
    expect(JSON.parse(JSON.stringify(payload))).toEqual({
      title: 'Nottinghamshire MvF', body: '', fixtureId: 'validated', withAvailability: true, url: '/news', data: { url: '/training' },
    })
  })


  test.each([undefined, null, [], 27, { json: () => null }])('a partial or unreadable message still produces a visible card', async message => {
    await fire('push', { data: message })
    expect(registration.showNotification).toHaveBeenCalledWith('Nottinghamshire MvF', expect.objectContaining({
      body: '', actions: [], data: { url: '/', fixtureId: null },
    }))
  })

  test('a JSON string becomes a plain-text notification', async () => {
    await fire('push', { data: { json: () => 'Training tonight' } })
    expect(registration.showNotification.mock.lastCall[1].body).toBe('Training tonight')
  })

  test('a legacy line-up deep link retains its destination and a training link overrides stale fixture metadata', async () => {
    const front = { ...windowClient(), visibilityState: 'visible' }
    clients.matchAll.mockResolvedValue([front])
    for (const [kind, url] of [['lineup', '/fixtures?mvf_fixture=f1&view=lineup'], ['training', '/training?session=s1']]) {
      await fire('push', { data: { json: () => ({ url, ...(kind === 'training' ? { fixtureId: 'f1', withAvailability: true } : {}) }) } })
      expect(front.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ kind, url }))
      expect(registration.showNotification.mock.lastCall[1]).toMatchObject({ data: { fixtureId: null, url }, actions: [] })
    }
  })

  test.each([[0, []], [1, ['in']], [2, ['in', 'out']]])('respects a tray with %i action slots', async (maxActions, expected) => {
    vi.stubGlobal('Notification', { maxActions })
    try {
      await fire('push', { data: { json: () => ({ withAvailability: true, fixtureId: 'f1', actions: [null, 2] }) } })
      expect(registration.showNotification.mock.lastCall[1].actions.map(a => a.action)).toEqual(expected)
    } finally { vi.unstubAllGlobals() }
  })

  test('ignores invalid optional metadata and uses default match actions when custom ones are unusable', async () => {
    await fire('push', { data: { json: () => ({
      fixtureId: 'f1', tag: [], teamKey: 'unknown', withAvailability: 'false', actions: [{}],
    }) } })
    expect(registration.showNotification.mock.lastCall[1]).toMatchObject({
      tag: 'match-f1', actions: [{ action: 'lineup', title: 'View line-up' }, { action: 'availability', title: 'Confirm availability' }],
    })
  })

  test('a failing client lookup still displays the OS card, and permission errors remain visible to the platform', async () => {
    clients.matchAll.mockRejectedValue(new Error('Window closed'))
    await fire('push', { data: null })
    expect(registration.showNotification).toHaveBeenCalledTimes(1)
    registration.showNotification.mockRejectedValueOnce(new DOMException('Permission revoked', 'NotAllowedError'))
    await expect(fire('push', { data: null })).rejects.toMatchObject({ name: 'NotAllowedError' })
    expect(registration.showNotification).toHaveBeenCalledTimes(2)
  })

  test.each([
    [{ data: { url: '/news' } }, '/news'],
    [{ url: '/club', data: { url: '/news' } }, '/club'],
    [{ data: { url: 'https://other.example/news' } }, '/'],
    [{ title: 'Club news', data: null }, '/'],
  ])('accepts a nested local destination and preserves top-level precedence', async (payload, url) => {
    await fire('push', { data: { json: () => payload } })
    expect(registration.showNotification.mock.lastCall[1].data.url).toBe(url)
  })

  test('ignores invalid optional tray fields and keeps useable custom actions', async () => {
    await fire('push', { data: { json: () => ({
      title: 'Club news', tag: {}, icon: 2, badge: {}, actions: [null, 'x', {}, { action: 'open', title: 'Read news' }],
    }) } })
    expect(registration.showNotification.mock.lastCall[1]).toMatchObject({
      icon: '/pwa-192x192.png', badge: '/push-badge.png', tag: undefined, renotify: false,
      actions: [{ action: 'open', title: 'Read news' }],
    })
  })

  test('old news and current scheduled sends can use the basic notification on a limited platform', async () => {
    const f = { id: 'f1', team: { key: 'xl', label: 'First Team' }, match_date: '2026-11-29', kickoff: '13:00', home_away: 'Home', opponent: { name: 'Westwood' } }
    for (const payload of [{ title: 'Club news', body: 'Training tonight', url: '/news' }, availabilityPayload(f), matchPayload(f)]) {
      registration.showNotification.mockRejectedValueOnce(new DOMException('Actions unsupported', 'NotSupportedError'))
      await fire('push', { data: { json: () => payload } })
      const [title, opts] = registration.showNotification.mock.lastCall
      expect(title).toBe(payload.title)
      expect(opts.body).toBe(payload.body)
      expect(opts.data).toMatchObject({ url: payload.url, fixtureId: payload.fixtureId ?? null })
      expect(opts.actions).toBeUndefined()
    }
  })
  test.each([
    ['Training moved', true], ['Training cancelled', false],
  ])('%s preserves its training tag and deep link without RSVP actions', async (title, canReply) => {
    await fire('push', { data: { json: () => ({
      title, body: 'Session details.', kind: 'training', canReply,
      tag: 'training-notice-1', url: '/training?session=s1',
      // Even stale fixture action fields cannot turn cancellation into an answer.
      fixtureId: 'f1', withAvailability: true, actions: [{ action: 'in', title: "I'm in" }],
    }) } })
    const [actualTitle, opts] = registration.showNotification.mock.calls[0]
    expect(actualTitle).toBe(title)
    expect(opts).toMatchObject({ tag: 'training-notice-1', renotify: true, actions: [], data: { url: '/training?session=s1', fixtureId: null } })
  })
  test.each(['xl', 'community'])('a %s line-up uses its team icon and reaches the foreground with its link', async teamKey => {
    const front = { ...windowClient(), visibilityState: 'visible', focused: true }
    const hidden = { ...windowClient(), visibilityState: 'hidden' }
    clients.matchAll.mockResolvedValue([hidden, front])
    await fire('push', { data: { json: () => ({ title: 'Squad named', kind: 'lineup', teamKey, fixtureId: 'f1' }) } })
    const url = '/fixtures?mvf_fixture=f1&view=lineup'
    expect(registration.showNotification).toHaveBeenCalledWith('Squad named', expect.objectContaining({
      icon: '/push-' + teamKey + '.png', badge: '/push-badge.png', tag: 'lineup-f1', renotify: false, silent: true,
      actions: [{ action: 'lineup', title: 'View line-up' }],
    }))
    expect(front.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'mvf-foreground', title: 'Squad named', teamKey, url }))
    expect(hidden.postMessage).not.toHaveBeenCalled()
  })
  test.each([
    [{ fixtureId: 'f1', withAvailability: true }, 'avail-f1', true],
    [{ fixtureId: 'f1' }, 'match-f1', true],
    [{ fixtureId: 'f1', kind: 'lineup' }, 'lineup-f1', false],
    [{ tag: 'news-story', url: '/news' }, 'news-story', false],
  ])('only background reminders re-alert on a repeated tag (%j)', async (payload, tag, reminder) => {
    await fire('push', { data: { json: () => payload } })
    expect(registration.showNotification.mock.lastCall[1]).toMatchObject({ tag, renotify: reminder })
    clients.matchAll.mockResolvedValue([{ ...windowClient(), visibilityState: 'visible' }])
    await fire('push', { data: { json: () => payload } })
    expect(registration.showNotification.mock.lastCall[1]).toMatchObject({ tag, renotify: false, silent: true })
  })
  test('adds Maybe when the platform has room for three actions', async () => {
    vi.stubGlobal('Notification', { maxActions: 3 })
    try {
      await fire('push', { data: { json: () => ({ fixtureId: 'f1', withAvailability: true }) } })
      expect(registration.showNotification.mock.calls[0][1].actions.map(a => a.action)).toEqual(['in', 'out', 'maybe'])
    } finally { vi.unstubAllGlobals() }
  })
  test('an availability nudge shows the two actions Chrome renders, tagged per kind per fixture, and renotifies', async () => {
    await fire('push', { data: { json: () => ({ title: 'Sunday?', body: 'In or out', fixtureId: 'f1', withAvailability: true, url: '/fixtures' }) } })
    const [title, opts] = registration.showNotification.mock.calls[0]
    expect(title).toBe('Sunday?')
    expect(opts.actions.map((a) => a.action)).toEqual(['in', 'out'])
    expect(opts.tag).toBe('avail-f1')
    expect(opts.renotify).toBe(true)
    expect(opts.data).toEqual({ url: '/fixtures', fixtureId: 'f1' })
  })

  test('a match reminder for the same game gets its own tag so it never replaces the nudge', async () => {
    await fire('push', { data: { json: () => ({ title: 'Kick-off soon', fixtureId: 'f1' }) } })
    expect(registration.showNotification.mock.calls[0][1].tag).toBe('match-f1')
  })

  test('an unparseable payload still shows something', async () => {
    await fire('push', { data: { json: () => { throw new Error('bad') }, text: () => 'plain text' } })
    expect(registration.showNotification.mock.calls[0][1].body).toBe('plain text')
  })
})

describe('notificationclick', () => {

  test.each([
    [null, '/'], ['/news', '/news'], [{ data: { url: '/training?session=s2' }, fixtureId: 'stale' }, '/training?session=s2'],
    [{ url: '/club', data: { url: '/news' } }, '/club'], [{ data: { url: 'https://other.example' }, fixtureId: {} }, '/'],
  ])('partial tray records retain safe destinations', async (data, expected) => {
    await fire('notificationclick', { action: 'in', notification: { data } })
    expect(clients.openWindow).toHaveBeenCalledWith(expected)
  })

  test('if storage is unavailable the player can still answer manually on the named fixture', async () => {
    const failure = vi.spyOn(self.caches, 'open').mockRejectedValue(new Error('Storage unavailable'))
    try {
      await fire('notificationclick', { action: 'maybe', notification: { data: { fixtureId: 'f1' } } })
      expect(clients.openWindow).toHaveBeenCalledWith('/fixtures?mvf_fixture=f1')
    } finally { failure.mockRestore() }
  })

  test('a window-only platform can route a partial tray entry if opening a new window fails', async () => {
    const existing = { navigate: vi.fn().mockResolvedValue(null) }
    clients.matchAll.mockResolvedValue([existing])
    clients.openWindow.mockRejectedValueOnce(new Error('New windows unavailable'))
    await fire('notificationclick', { notification: { data: '/news' } })
    expect(existing.navigate).toHaveBeenCalledWith('/news')
  })

  test('a lookup failure still opens the named destination', async () => {
    clients.matchAll.mockRejectedValue(new Error('Windows unavailable'))
    await fire('notificationclick', { notification: { data: { url: '/news' } } })
    expect(clients.openWindow).toHaveBeenCalledWith('/news')
  })

  test('if a stale tab fails to focus, the action reaches the next usable tab exactly once', async () => {
    const old = { ...windowClient(), focus: vi.fn().mockRejectedValue(new Error('Tab closed')) }
    const ready = windowClient()
    clients.matchAll.mockResolvedValue([old, ready])
    await fire('notificationclick', { action: 'out', notification: { data: { fixtureId: 'f1' } } })
    expect(old.postMessage).not.toHaveBeenCalled()
    expect(ready.postMessage).toHaveBeenCalledTimes(1)
    expect(ready.postMessage).toHaveBeenCalledWith({ type: 'mvf-avail', fixtureId: 'f1', status: 'out' })
    expect(clients.openWindow).not.toHaveBeenCalled()
  })

  test('a training event opens its particular session in an open or cold app', async () => {
    const data = { url: '/training?session=s1', fixtureId: null }
    const c = windowClient()
    clients.matchAll.mockResolvedValue([c])
    await fire('notificationclick', { action: '', notification: { close: vi.fn(), data } })
    expect(c.postMessage).toHaveBeenCalledWith({ type: 'mvf-navigate', url: '/training?session=s1' })
    clients.matchAll.mockResolvedValue([])
    await fire('notificationclick', { action: 'in', notification: { close: vi.fn(), data } })
    expect(clients.openWindow).toHaveBeenCalledWith('/training?session=s1')
  })
  test.each(['availability', 'lineup'])('the %s tray button opens the matching sheet on cold and warm launch', async action => {
    const data = { url: '/fixtures', fixtureId: 'fix-2' }
    const url = '/fixtures?mvf_fixture=fix-2' + (action === 'lineup' ? '&view=lineup' : '')
    await fire('notificationclick', { action, notification: { close: vi.fn(), data } })
    expect(clients.openWindow).toHaveBeenCalledWith(url)
    const warm = windowClient()
    clients.matchAll.mockResolvedValue([warm])
    await fire('notificationclick', { action, notification: { close: vi.fn(), data } })
    expect(warm.postMessage).toHaveBeenCalledWith({ type: 'mvf-navigate', url })
  })
  test('tapping the reminder body opens the particular game, including on browsers without tray actions', async () => {
    const data = { url: '/fixtures', fixtureId: 'next-away' }
    const c = windowClient()
    clients.matchAll.mockResolvedValue([c])
    await fire('notificationclick', { action: '', notification: { close: vi.fn(), data } })
    expect(c.postMessage).toHaveBeenCalledWith({ type: 'mvf-navigate', url: '/fixtures?mvf_fixture=next-away' })
    clients.matchAll.mockResolvedValue([])
    await fire('notificationclick', { action: '', notification: { close: vi.fn(), data } })
    expect(clients.openWindow).toHaveBeenCalledWith('/fixtures?mvf_fixture=next-away')
  })
  test('an inline In/Out tap with the app open posts the availability to the page and focuses it', async () => {
    const c = windowClient()
    clients.matchAll.mockResolvedValue([c])
    await fire('notificationclick', { action: 'in', notification: { close: vi.fn(), data: { url: '/fixtures', fixtureId: 'f1' } } })
    expect(c.postMessage).toHaveBeenCalledWith({ type: 'mvf-avail', fixtureId: 'f1', status: 'in' })
    expect(c.focus).toHaveBeenCalled()
    expect(clients.openWindow).not.toHaveBeenCalled()
  })

  test('a plain tap (news, line-up) with the app open NAVIGATES it — it used to just focus whatever screen was up', async () => {
    const c = windowClient()
    clients.matchAll.mockResolvedValue([c])
    await fire('notificationclick', { action: '', notification: { close: vi.fn(), data: { url: '/news', fixtureId: null } } })
    expect(c.postMessage).toHaveBeenCalledWith({ type: 'mvf-navigate', url: '/news' })
    expect(c.focus).toHaveBeenCalled()
  })

  test('with no open window, opens one at the deep link', async () => {
    clients.matchAll.mockResolvedValue([])
    await fire('notificationclick', { action: 'out', notification: { close: vi.fn(), data: { url: '/fixtures', fixtureId: 'f1' } } })
    // The URL carries a random nonce, never the fixture/status themselves.
    const opened = clients.openWindow.mock.calls[0][0]
    const m = /^\/fixtures\?mvf_action=([0-9a-f]{32})$/.exec(opened)
    expect(m).not.toBeNull()
    expect(opened).not.toMatch(/mvf_fixture|mvf_avail/)
    const stored = JSON.parse(cacheStore.get('/__mvf_action/' + m[1]))
    expect(stored.fixtureId).toBe('f1')
    expect(stored.status).toBe('out')
    expect(stored.expiresAt - Date.now()).toBeGreaterThan(5 * 60 * 1000)
    expect(stored.expiresAt - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000)
  })
})

describe('pushsubscriptionchange', () => {
  test('re-subscribes with the old key when the browser rotates the subscription', async () => {
    const key = new Uint8Array([1, 2, 3]).buffer
    await fire('pushsubscriptionchange', { oldSubscription: { options: { applicationServerKey: key } }, newSubscription: null })
    expect(registration.pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: key })
  })

  test('when the browser already made the new subscription there is nothing to do, and no key never throws', async () => {
    await expect(fire('pushsubscriptionchange', { oldSubscription: null, newSubscription: { endpoint: 'x' } })).resolves.toBeTruthy()
    expect(registration.pushManager.subscribe).not.toHaveBeenCalled()
    await expect(fire('pushsubscriptionchange', { oldSubscription: null, newSubscription: null })).resolves.toBeTruthy()
  })
})

// A push payload's `url` is attacker-shaped data as far as the SW is
// concerned: clients.openWindow() opens ANY absolute URL, so an off-origin
// value would turn a club notification into a tap-to-visit link for somewhere
// else. These pin the same rules safeAppPath() enforces in the app
// (src/lib/navigation.js) — the SW restates them because it can't import.
describe('notificationclick — the deep link is not trusted', () => {
  test('an absolute off-origin url falls back to the app root, open window or not', async () => {
    const c = windowClient()
    clients.matchAll.mockResolvedValue([c])
    await fire('notificationclick', { action: '', notification: { close: vi.fn(), data: { url: 'https://evil.example/steal' } } })
    expect(c.postMessage).toHaveBeenCalledWith({ type: 'mvf-navigate', url: '/' })

    clients.matchAll.mockResolvedValue([])
    await fire('notificationclick', { action: '', notification: { close: vi.fn(), data: { url: 'https://evil.example/steal' } } })
    expect(clients.openWindow).toHaveBeenCalledWith('/')
  })

  test('the backslash escape out of the app is refused (CVE-2025-68470 shape)', async () => {
    clients.matchAll.mockResolvedValue([])
    await fire('notificationclick', { action: '', notification: { close: vi.fn(), data: { url: '/' + BS + 'evil.example' } } })
    expect(clients.openWindow).toHaveBeenCalledWith('/')
  })

  test('protocol-relative, javascript: and control-character urls are all refused', async () => {
    clients.matchAll.mockResolvedValue([])
    for (const url of ['//evil.example', 'javascript:alert(1)', '/' + TAB + 'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>']) {
      vi.clearAllMocks()
      await fire('notificationclick', { action: '', notification: { close: vi.fn(), data: { url } } })
      expect(clients.openWindow).toHaveBeenCalledWith('/')
    }
  })

  test('a genuine in-app deep link still works, query and all', async () => {
    clients.matchAll.mockResolvedValue([])
    await fire('notificationclick', { action: '', notification: { close: vi.fn(), data: { url: '/news?id=7' } } })
    expect(clients.openWindow).toHaveBeenCalledWith('/news?id=7')
  })
})
