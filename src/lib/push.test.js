import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

// Store-driven supabase stub: push.js reads/writes push_tokens.
const db = vi.hoisted(() => ({ rows: [], upserts: [], deletes: [] }))
vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: db.rows, error: null }) }) }),
      upsert: (row) => { db.upserts.push(row); return Promise.resolve({ error: null }) },
      delete: () => { db.deletes.push(1); return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) } },
    }),
  },
}))

// push.js captures the VAPID key at import time — stub it BEFORE the dynamic
// import so the key-match logic has a real value to compare against.
vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'AQID') // -> bytes [1,2,3]
const { urlBase64ToUint8Array, subscriptionMatchesKey, syncPush, disablePush } = await import('./push')

const KEY_BYTES = urlBase64ToUint8Array('AQID')

// A push environment for syncPush: jsdom has no serviceWorker/PushManager.
function pushEnv({ sub }) {
  const reg = {
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(sub),
      subscribe: vi.fn().mockResolvedValue({ endpoint: 'https://push/new' }),
    },
  }
  Object.defineProperty(navigator, 'serviceWorker', { value: { ready: Promise.resolve(reg) }, configurable: true })
  window.PushManager = function () {}
  window.Notification = { permission: 'granted' }
  return reg
}

beforeEach(() => { db.rows = []; db.upserts = []; db.deletes = [] })
afterEach(() => {
  delete navigator.serviceWorker
  delete window.PushManager
  delete window.Notification
})

describe('urlBase64ToUint8Array', () => {
  test('decodes standard base64 to the right bytes', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3])
  })
  test('handles url-safe chars (- _) and missing padding', () => {
    const out = urlBase64ToUint8Array('A-_-')
    expect(out).toBeInstanceOf(Uint8Array)
    expect(out.length).toBe(3)
  })
})

describe('subscriptionMatchesKey', () => {
  test('true when the subscription was created under our key', () => {
    expect(subscriptionMatchesKey({ options: { applicationServerKey: KEY_BYTES.buffer } }, 'AQID')).toBe(true)
  })
  test('false when the key was rotated away', () => {
    expect(subscriptionMatchesKey({ options: { applicationServerKey: urlBase64ToUint8Array('BAUG').buffer } }, 'AQID')).toBe(false)
  })
  test('true (no churn) when the browser hides the key', () => {
    expect(subscriptionMatchesKey({ options: {} }, 'AQID')).toBe(true)
  })
})

// The silent-death heal: the server prunes a token on 404/410 (expired
// subscription) but the browser still hands back the dead sub — the player
// never received a reminder again and nothing ever fixed it.
describe('syncPush — startup heal', () => {
  const liveSub = () => ({ endpoint: 'https://push/old', options: { applicationServerKey: KEY_BYTES.buffer } })

  test('healthy device (sub + matching row) is left alone', async () => {
    const sub = { ...liveSub(), unsubscribe: vi.fn() }
    const reg = pushEnv({ sub })
    db.rows = [{ id: 'row1' }] // the row for this exact token exists
    await syncPush('u1')
    expect(sub.unsubscribe).not.toHaveBeenCalled()
    expect(reg.pushManager.subscribe).not.toHaveBeenCalled()
    expect(db.upserts).toHaveLength(0)
  })

  test('a pruned token row → the dead sub is replaced and the fresh one stored', async () => {
    const sub = { ...liveSub(), unsubscribe: vi.fn().mockResolvedValue(true) }
    const reg = pushEnv({ sub })
    db.rows = [] // server pruned it after delivery failures
    await syncPush('u1')
    expect(sub.unsubscribe).toHaveBeenCalled()
    expect(reg.pushManager.subscribe).toHaveBeenCalled()
    expect(db.upserts).toHaveLength(1)
    expect(db.upserts[0].profile_id).toBe('u1')
  })

  test('no subscription on this device → nothing happens (opt-in stays explicit)', async () => {
    const reg = pushEnv({ sub: null })
    await syncPush('u1')
    expect(reg.pushManager.subscribe).not.toHaveBeenCalled()
    expect(db.upserts).toHaveLength(0)
  })
})

// Turning notifications OFF must stick. disablePush used to delete the token
// row FIRST and unsubscribe second; when unsubscribe() rejected (offline, SW
// mid-update — and sign-out races it against a 2.5s timeout) the row was gone
// but the browser subscription lived on, which is exactly the "server pruned
// my token" shape syncPush heals by re-subscribing AND re-storing it. The
// player switched push off; the next app open switched it back on.
describe('disablePush — opt-out survives a flaky unsubscribe', () => {
  test('a failed unsubscribe keeps the token row so syncPush cannot re-enable', async () => {
    const sub = { endpoint: 'https://push/old', unsubscribe: vi.fn().mockRejectedValue(new Error('offline')) }
    pushEnv({ sub })
    await expect(disablePush('u1')).rejects.toThrow('offline')
    expect(db.deletes).toHaveLength(0)
  })

  test('a successful unsubscribe then removes the row', async () => {
    const sub = { endpoint: 'https://push/old', unsubscribe: vi.fn().mockResolvedValue(true) }
    pushEnv({ sub })
    await disablePush('u1')
    expect(sub.unsubscribe).toHaveBeenCalled()
    expect(db.deletes).toHaveLength(1)
  })
})
