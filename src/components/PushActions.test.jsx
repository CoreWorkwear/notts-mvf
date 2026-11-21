import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// Capture setAvailability calls; assert each notification action persists ITS OWN
// status (the bug report: "I'm in" must write 'in', never 'maybe').
const setAvailability = vi.hoisted(() => vi.fn().mockResolvedValue({ error: null }))
vi.mock('../hooks/useFixtures', () => ({ setAvailability }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))

import PushActions from './PushActions'
import { ACTION_CACHE, ACTION_PREFIX } from '../lib/pushAction'

// In-memory Cache Storage stand-in (jsdom has none).
const store = { map: new Map() }
const fakeCaches = {
  open: async (name) => {
    expect(name).toBe(ACTION_CACHE)
    return {
      match: async (k) => (store.map.has(k) ? new Response(store.map.get(k)) : undefined),
      delete: async (k) => store.map.delete(k),
    }
  },
}
let counter = 0
async function stash({ fixtureId, status, expiresAt = Date.now() + 60_000 }) {
  const nonce = (++counter).toString(16).padStart(32, 'a')
  store.map.set(ACTION_PREFIX + nonce, JSON.stringify({ fixtureId, status, expiresAt }))
  return nonce
}

// Minimal serviceWorker stub (jsdom has none) so the 'message' path works.
let swListeners = []
beforeEach(() => {
  store.map.clear()
  globalThis.caches = fakeCaches
  setAvailability.mockClear()
  swListeners = []
  navigator.serviceWorker = {
    addEventListener: (t, fn) => { if (t === 'message') swListeners.push(fn) },
    removeEventListener: (t, fn) => { swListeners = swListeners.filter((f) => f !== fn) },
    startMessages: vi.fn(),
  }
  window.history.replaceState(null, '', '/fixtures')
})
afterEach(() => { delete navigator.serviceWorker; delete globalThis.caches })

describe('PushActions — notification action → availability status', () => {
  test.each(['in', 'maybe', 'out'])('a valid stored nonce applies %s exactly, once, then is deleted', async (status) => {
    const nonce = await stash({ fixtureId: 'f1', status })
    window.history.replaceState(null, '', `/fixtures?mvf_action=${nonce}`)
    render(<PushActions />)
    await waitFor(() => expect(setAvailability).toHaveBeenCalledWith('f1', 'u1', status))
    expect(setAvailability).toHaveBeenCalledTimes(1)
    expect(store.map.has(ACTION_PREFIX + nonce)).toBe(false)
    expect(window.location.search).toBe('')
  })

  test('the same nonce cannot be replayed', async () => {
    const nonce = await stash({ fixtureId: 'f1', status: 'in' })
    window.history.replaceState(null, '', `/fixtures?mvf_action=${nonce}`)
    const first = render(<PushActions />)
    await waitFor(() => expect(setAvailability).toHaveBeenCalledTimes(1))
    first.unmount()
    window.history.replaceState(null, '', `/fixtures?mvf_action=${nonce}`)
    render(<PushActions />)
    await new Promise((r) => setTimeout(r, 20))
    expect(setAvailability).toHaveBeenCalledTimes(1)
  })

  test('an expired nonce does nothing', async () => {
    const nonce = await stash({ fixtureId: 'f1', status: 'in', expiresAt: Date.now() - 1000 })
    window.history.replaceState(null, '', `/fixtures?mvf_action=${nonce}`)
    render(<PushActions />)
    await new Promise((r) => setTimeout(r, 20))
    expect(setAvailability).not.toHaveBeenCalled()
    expect(store.map.has(ACTION_PREFIX + nonce)).toBe(false)
  })

  test('forged links do nothing: old mvf_fixture/mvf_avail params and unknown nonces', async () => {
    window.history.replaceState(null, '', '/fixtures?mvf_fixture=f1&mvf_avail=out')
    render(<PushActions />)
    await new Promise((r) => setTimeout(r, 20))
    expect(setAvailability).not.toHaveBeenCalled()

    window.history.replaceState(null, '', '/fixtures?mvf_action=' + 'a'.repeat(32))
    render(<PushActions />)
    window.history.replaceState(null, '', '/fixtures?mvf_action=../../x')
    render(<PushActions />)
    await new Promise((r) => setTimeout(r, 20))
    expect(setAvailability).not.toHaveBeenCalled()
  })

  test.each(['in', 'maybe', 'out'])('the app-open postMessage path applies %s exactly', async (status) => {
    render(<PushActions />)
    swListeners.forEach((fn) => fn({ data: { type: 'mvf-avail', fixtureId: 'f2', status } }))
    await waitFor(() => expect(setAvailability).toHaveBeenCalledWith('f2', 'u1', status))
    expect(setAvailability).toHaveBeenCalledTimes(1)
  })

  test('ignores an unknown action', async () => {
    render(<PushActions />)
    swListeners.forEach((fn) => fn({ data: { type: 'mvf-avail', fixtureId: 'f3', status: 'bogus' } }))
    expect(setAvailability).not.toHaveBeenCalled()
  })

  test('starts SW message delivery — addEventListener alone leaves the queue paused', async () => {
    // Without startMessages() the browser queues the SW's postMessage forever
    // and the app-open one-tap availability path never delivers.
    render(<PushActions />)
    expect(navigator.serviceWorker.startMessages).toHaveBeenCalled()
  })
})

// A tapped news / line-up notification with the app already open: the SW
// posts an mvf-navigate message and the page must turn it into a route change
// (PushActions sits outside the router, so it re-broadcasts as a window event
// the App listens for).
describe('PushActions — notification tap navigates the open app', () => {
  test('an mvf-navigate SW message becomes an mvf-navigate window event with the url', async () => {
    const seen = []
    window.addEventListener('mvf-navigate', (e) => seen.push(e.detail?.url))
    render(<PushActions />)
    swListeners.forEach((fn) => fn({ data: { type: 'mvf-navigate', url: '/news' } }))
    expect(seen).toEqual(['/news'])
  })
})
