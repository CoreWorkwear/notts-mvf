import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

// timeoutFetch is the fetch every Supabase call goes through. It must (a) stop
// a cold-start query hanging forever, (b) NOT abort a legitimately slow photo
// upload, and (c) leave a breadcrumb for the anomalies so a later error row
// explains itself. createClient is stubbed so the module loads without a network.
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ stub: true })) }))
vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co')
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon')

const { supabase, hasStoredSession, timeoutFetch, requestLabel, REQUEST_TIMEOUT_MS, UPLOAD_TIMEOUT_MS, SLOW_REQUEST_MS } = await import('./supabase')
const { getBreadcrumbs, clearBreadcrumbs } = await import('./breadcrumbs')

// A fetch that resolves after `ms` (or rejects when aborted first).
function slowFetch(ms, status = 200) {
  return vi.fn((_input, init) => new Promise((res, rej) => {
    const t = setTimeout(() => res(new Response('ok', { status })), ms)
    init.signal.addEventListener('abort', () => { clearTimeout(t); rej(init.signal.reason) })
  }))
}

beforeEach(() => { vi.useFakeTimers(); clearBreadcrumbs() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('requestLabel', () => {
  test('is method + path only — the query string (filters, occasionally an email) is never recorded', () => {
    expect(requestLabel('https://x.supabase.co/rest/v1/profile_private?email=eq.joe%40x.y', { method: 'GET' })).toBe('GET /rest/v1/profile_private')
    expect(requestLabel('https://x.supabase.co/auth/v1/token?grant_type=refresh_token', { method: 'POST' })).toBe('POST /auth/v1/token')
    expect(requestLabel(new Request('https://x.supabase.co/rest/v1/fixtures', { method: 'PATCH' }))).toBe('PATCH /rest/v1/fixtures')
  })
})

describe('timeoutFetch', () => {
  test('a query that never answers is aborted at the ceiling with a TimeoutError and a breadcrumb', async () => {
    vi.stubGlobal('fetch', slowFetch(10 * 60 * 1000))
    const p = timeoutFetch('https://x.supabase.co/rest/v1/fixtures?select=*', { method: 'GET' })
    const settled = expect(p).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1)
    await settled
    expect(getBreadcrumbs().map((c) => c.m)).toContain('GET /rest/v1/fixtures timed out')
  })

  test('a slow STORAGE upload is not cut off by the query ceiling (a 3G pitch-side photo takes longer than 20s)', async () => {
    vi.stubGlobal('fetch', slowFetch(45_000))
    const p = timeoutFetch('https://x.supabase.co/storage/v1/object/media/players/a.jpg', { method: 'POST', body: new Blob(['x']) })
    await vi.advanceTimersByTimeAsync(45_001)
    await expect(p).resolves.toBeInstanceOf(Response)
    expect(UPLOAD_TIMEOUT_MS).toBeGreaterThan(REQUEST_TIMEOUT_MS)
  })

  test('a normal fast request leaves no breadcrumb and clears its timer', async () => {
    vi.stubGlobal('fetch', slowFetch(50))
    const p = timeoutFetch('https://x.supabase.co/rest/v1/teams', { method: 'GET' })
    await vi.advanceTimersByTimeAsync(60)
    await expect(p).resolves.toBeInstanceOf(Response)
    expect(getBreadcrumbs()).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  test('an HTTP error status and a slow-but-successful request each leave a crumb', async () => {
    vi.stubGlobal('fetch', slowFetch(10, 401))
    let p = timeoutFetch('https://x.supabase.co/rest/v1/fixtures', { method: 'GET' })
    await vi.advanceTimersByTimeAsync(20)
    await p
    expect(getBreadcrumbs().at(-1).m).toBe('GET /rest/v1/fixtures → 401')

    vi.stubGlobal('fetch', slowFetch(SLOW_REQUEST_MS + 10))
    p = timeoutFetch('https://x.supabase.co/rest/v1/results', { method: 'GET' })
    await vi.advanceTimersByTimeAsync(SLOW_REQUEST_MS + 20)
    await p
    expect(getBreadcrumbs().at(-1).m).toBe('GET /rest/v1/results slow')
  })

  test('a network failure is recorded with the error name', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Load failed'))))
    await expect(timeoutFetch('https://x.supabase.co/rest/v1/news', { method: 'GET' })).rejects.toThrow('Load failed')
    expect(getBreadcrumbs().at(-1).m).toBe('GET /rest/v1/news failed: TypeError')
  })

  test("still honours the caller's own abort signal", async () => {
    vi.stubGlobal('fetch', slowFetch(10_000))
    const ctl = new AbortController()
    const p = timeoutFetch('https://x.supabase.co/rest/v1/x', { method: 'GET', signal: ctl.signal })
    const settled = expect(p).rejects.toMatchObject({ name: 'AbortError' })
    ctl.abort(new DOMException('gone', 'AbortError'))
    await settled
  })
})

// AuthContext leans on this to tell "not restored yet" from "signed out".
describe('hasStoredSession', () => {
  const KEY = 'sb-test-auth-token'
  beforeEach(() => { vi.useRealTimers(); supabase.auth = { storageKey: KEY }; localStorage.clear() })
  afterEach(() => { delete supabase.auth; localStorage.clear(); vi.restoreAllMocks() })

  test('true while supabase-js still has a session under its storage key', () => {
    localStorage.setItem(KEY, JSON.stringify({ refresh_token: 'r' }))
    expect(hasStoredSession()).toBe(true)
  })
  test('false once it has been removed (signed out, or the refresh token was refused)', () => {
    expect(hasStoredSession()).toBe(false)
  })
  test('another project\'s session on the same origin does not count', () => {
    localStorage.setItem('sb-other-auth-token', '{}')
    expect(hasStoredSession()).toBe(false)
  })
  test('blocked storage reads as "nothing stored", never a throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    expect(hasStoredSession()).toBe(false)
  })
})

test('an offline availability write is refused before it can reach fetch', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  const send = vi.fn(async () => new Response())
  vi.stubGlobal('fetch', send)
  try {
    await expect(timeoutFetch('https://x.supabase.co/rest/v1/availability', { method: 'POST' })).rejects.toThrow(/offline/i)
    expect(send).not.toHaveBeenCalled()
  } finally { vi.restoreAllMocks(); vi.unstubAllGlobals() }
})
