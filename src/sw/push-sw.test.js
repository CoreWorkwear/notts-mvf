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

beforeAll(async () => {
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

const windowClient = () => ({ focus: vi.fn(() => Promise.resolve()), postMessage: vi.fn() })

describe('push → notification', () => {
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
    expect(clients.openWindow).toHaveBeenCalledWith('/fixtures?mvf_fixture=f1&mvf_avail=out')
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
