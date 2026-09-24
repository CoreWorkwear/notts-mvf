import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

// The client error log is the only telemetry the app has — these tests pin
// what a row carries (enough to diagnose from Diagnostics alone), what it
// must NEVER carry (PII), and the flood/offline behaviour.
const db = vi.hoisted(() => ({ inserts: [], insertResult: { error: null }, reject: null }))
vi.mock('./supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: 'u-me' } } } })) },
    from: () => ({
      insert: (row) => {
        if (db.reject) return Promise.reject(db.reject)
        db.inserts.push(row)
        return Promise.resolve(db.insertResult)
      },
    }),
  },
}))

import {
  buildErrorRow, isActionableWindowError, isNoiseError, scrub, enrichContext, shouldSend, logError,
  flushQueue, _resetLogBudget, _queuedRows, MAX_PER_SESSION, DEDUPE_WINDOW_MS, BUILD, BUDGET_WINDOW_MS,
} from './logger'
import { breadcrumb, clearBreadcrumbs } from './breadcrumbs'

beforeEach(() => {
  db.inserts = []
  db.insertResult = { error: null }
  db.reject = null
  _resetLogBudget()
  clearBreadcrumbs()
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})
afterEach(() => { vi.useRealTimers() })

describe('isNoiseError', () => {
  test('drops offline service-worker update failures (the live-log noise)', () => {
    expect(isNoiseError("Failed to update a ServiceWorker for scope ('https://notts-mvf.pages.dev/') with script ('https://notts-mvf.pages.dev/sw.js'): An unknown error occurred when fetching the script.")).toBe(true)
    expect(isNoiseError("Failed to update a ServiceWorker for scope ('https://notts-mvf.pages.dev/') with script ('Unknown'): The object is in an invalid state.")).toBe(true)
  })
  test('keeps real failures', () => {
    expect(isNoiseError('TypeError: Load failed')).toBe(false)
    expect(isNoiseError('Internal error')).toBe(false)
    expect(isNoiseError(null)).toBe(false)
  })
})

describe('isActionableWindowError', () => {
  test('drops the opaque cross-origin "Script error." noise', () => {
    expect(isActionableWindowError({ message: 'Script error.', error: null })).toBe(false)
    expect(isActionableWindowError({ message: 'Script error', error: null })).toBe(false)
    expect(isActionableWindowError({ message: '', error: null })).toBe(false)
  })
  test('keeps a real same-origin error (has an Error object)', () => {
    expect(isActionableWindowError({ message: 'x is not a function', error: new Error('x is not a function') })).toBe(true)
  })
  test('keeps a detailed message even without an Error object', () => {
    expect(isActionableWindowError({ message: 'ResizeObserver loop limit exceeded' })).toBe(true)
  })
})

describe('buildErrorRow', () => {
  test('keeps the essentials and defaults kind', () => {
    const row = buildErrorRow({ message: 'boom', context: { a: 1 }, profileId: 'u1', url: '/fixtures', userAgent: 'UA' })
    expect(row).toMatchObject({ kind: 'error', message: 'boom', context: { a: 1 }, profile_id: 'u1', url: '/fixtures', user_agent: 'UA' })
  })

  test('truncates a runaway message', () => {
    expect(buildErrorRow({ kind: 'render', message: 'x'.repeat(5000) }).message).toHaveLength(1000)
  })

  test('survives a circular context instead of throwing', () => {
    const c = {}; c.self = c
    const row = buildErrorRow({ kind: 'render', message: 'm', context: c })
    expect(row.context).toEqual({ self: '[circular]' })
  })

  test('null-safes optional fields', () => {
    const row = buildErrorRow({ message: undefined })
    expect(row.message).toBe('Unknown error')
    expect(row.context).toBeNull()
    expect(row.profile_id).toBeNull()
    expect(row.url).toBeNull()
  })
})

describe('scrub — PII never reaches client_errors', () => {
  test('redacts sensitive keys wholesale, at any depth', () => {
    const out = scrub({ op: 'save', email: 'a@b.c', nested: { phone: '07700', dob: '1980-01-01', ec_phone: 'x', fine: 'ok' }, token: 't' })
    expect(out).toEqual({ op: 'save', email: '[redacted]', nested: { phone: '[redacted]', dob: '[redacted]', ec_phone: '[redacted]', fine: 'ok' }, token: '[redacted]' })
  })

  test('masks JWTs and email addresses inside strings (Supabase error text echoes them)', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    expect(scrub(`bad token ${jwt}`)).toBe('bad token [jwt]')
    expect(scrub('duplicate key: (email)=(joe.bloggs@example.com) already exists')).toContain('[email]')
    expect(scrub('duplicate key: (email)=(joe.bloggs@example.com) already exists')).not.toContain('joe.bloggs')
  })

  test('the message itself is scrubbed, not just the context', () => {
    expect(buildErrorRow({ message: 'User bob@club.org not found' }).message).toBe('User [email] not found')
  })

  test('leaves ordinary values and arrays alone', () => {
    expect(scrub({ fixtureId: 'f1', ids: ['a', 'b'], n: 3, ok: true })).toEqual({ fixtureId: 'f1', ids: ['a', 'b'], n: 3, ok: true })
  })
})

describe('enrichContext — every row can be diagnosed from Diagnostics alone', () => {
  test('carries the build, route, connectivity and the breadcrumb tail', () => {
    breadcrumb('nav', '/fixtures')
    breadcrumb('fetch', 'GET /rest/v1/fixtures → 500')
    const ctx = enrichContext({ hook: 'useFixtures' })
    expect(ctx.build).toBe(BUILD)
    expect(BUILD).not.toBe('dev') // vite.config.js stamps <version>+<sha> into tests too
    expect(ctx).toMatchObject({ hook: 'useFixtures', route: expect.any(String), online: true })
    expect(ctx.breadcrumbs.map((c) => c.m)).toEqual(['/fixtures', 'GET /rest/v1/fixtures → 500'])
    expect(typeof ctx.sinceLoadMs).toBe('number')
  })

  test('a Supabase error keeps code / status / hint — the fields that tell an RLS refusal from a stale token', () => {
    const ctx = enrichContext({ hook: 'x' }, { message: 'permission denied', code: '42501', hint: 'check policy', status: 403 })
    expect(ctx).toMatchObject({ errName: 'Error', code: '42501', hint: 'check policy', status: 403 })
  })

  test('a thrown Error contributes its stack without clobbering an explicit one', () => {
    const e = new Error('boom')
    expect(enrichContext({}, e).stack).toContain('boom')
    expect(enrichContext({ stack: 'mine' }, e).stack).toBe('mine')
  })
})

describe('shouldSend — a repeat inside the window is collapsed', () => {
  test('same kind+message within DEDUPE_WINDOW_MS is not re-sent; a different one is', () => {
    expect(shouldSend('fetch', 'Load failed', 1000)).toBe(true)
    expect(shouldSend('fetch', 'Load failed', 1000 + DEDUPE_WINDOW_MS - 1)).toBe(false)
    expect(shouldSend('write', 'Load failed', 1000)).toBe(true)
    expect(shouldSend('fetch', 'Load failed', 1000 + DEDUPE_WINDOW_MS + 1)).toBe(true)
  })
})

describe('logError — end to end', () => {
  test('accepts the error object itself and writes a fully enriched, scrubbed row', async () => {
    breadcrumb('nav', '/you')
    const err = Object.assign(new Error('permission denied for table profile_private'), { code: '42501', hint: 'h' })
    await logError('write', err, { op: 'profileSave', email: 'me@x.y' })
    expect(db.inserts).toHaveLength(1)
    const row = db.inserts[0]
    expect(row).toMatchObject({ kind: 'write', message: 'permission denied for table profile_private', profile_id: 'u-me' })
    expect(row.context).toMatchObject({ op: 'profileSave', email: '[redacted]', code: '42501', hint: 'h', build: BUILD })
    expect(row.context.breadcrumbs.some((c) => c.m === '/you')).toBe(true)
  })

  test('a duplicate within a minute is not inserted twice', async () => {
    await logError('fetch', 'Load failed', { hook: 'a' })
    await logError('fetch', 'Load failed', { hook: 'b' })
    expect(db.inserts).toHaveLength(1)
  })

  test('respects the per-window budget so a loop cannot flood the table', async () => {
    for (let i = 0; i < MAX_PER_SESSION + 10; i++) await logError('error', `distinct ${i}`)
    expect(db.inserts).toHaveLength(MAX_PER_SESSION)
  })

  test('the budget is a rolling window, not a lifetime cap — a PWA open for days keeps reporting', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T10:00:00Z'))
    for (let i = 0; i < MAX_PER_SESSION; i++) await logError('error', `first-batch ${i}`)
    expect(db.inserts).toHaveLength(MAX_PER_SESSION)
    vi.setSystemTime(new Date(Date.now() + BUDGET_WINDOW_MS + 1000))
    await logError('error', 'a day later')
    expect(db.inserts).toHaveLength(MAX_PER_SESSION + 1)
  })

  test('never throws, even when the insert itself blows up', async () => {
    db.reject = new TypeError('Load failed')
    await expect(logError('fetch', 'x')).resolves.toBeUndefined()
  })

  test('an error itself becomes a breadcrumb for the next one', async () => {
    await logError('fetch', 'first thing broke')
    await logError('write', 'then this broke')
    expect(db.inserts[1].context.breadcrumbs.some((c) => c.c === 'error' && /first thing broke/.test(c.m))).toBe(true)
  })
})

describe('logError — offline queue', () => {
  test('offline: the row is queued, not lost, and flushes when the connection returns', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    await logError('write', 'saved nothing')
    expect(db.inserts).toHaveLength(0)
    expect(_queuedRows()).toHaveLength(1)

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    await flushQueue()
    expect(db.inserts).toHaveLength(1)
    expect(_queuedRows()).toHaveLength(0)
  })

  test('a network-level insert failure queues the row; a response-level one (RLS) drops it', async () => {
    db.reject = new TypeError('Load failed')
    await logError('fetch', 'dropped on the floor')
    expect(_queuedRows()).toHaveLength(1)

    _resetLogBudget()
    db.reject = null
    db.insertResult = { error: { message: 'row-level security', code: '42501' } }
    await logError('fetch', 'refused')
    expect(_queuedRows()).toHaveLength(0)
  })

  test('flush stops at the first failure so a still-dead link does not churn', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    await logError('a', 'one'); await logError('a', 'two')
    expect(_queuedRows()).toHaveLength(2)
    db.reject = new TypeError('Load failed')
    await flushQueue()
    expect(_queuedRows()).toHaveLength(2)
  })
})
