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
beforeEach(() => { vi.clearAllMocks() })

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
