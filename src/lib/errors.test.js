import { describe, test, expect } from 'vitest'
import { describeError, friendlyError, isNetworkError, isAuthStale, isClockSkew, isPermissionDenied } from './errors'

describe('describeError — one shape for every error we meet', () => {
  test('a thrown Error keeps name, message and stack', () => {
    const d = describeError(new TypeError('Load failed'))
    expect(d).toMatchObject({ name: 'TypeError', message: 'Load failed', code: null, status: null })
    expect(d.stack).toContain('Load failed')
  })

  test('a PostgrestError-shaped object keeps code / details / hint / status', () => {
    const d = describeError({ message: 'permission denied for table availability', code: '42501', details: 'd', hint: 'h', status: 403 })
    expect(d).toMatchObject({ code: '42501', details: 'd', hint: 'h', status: 403 })
  })

  test('a DOMException from the fetch ceiling is a TimeoutError', () => {
    const d = describeError(new DOMException('Request timed out', 'TimeoutError'))
    expect(d.name).toBe('TimeoutError')
    expect(isNetworkError(d)).toBe(true)
  })

  test('a bare string, null and a non-Error reason all describe safely', () => {
    expect(describeError('boom').message).toBe('boom')
    expect(describeError(null).message).toBe('Unknown error')
    expect(describeError(42).message).toBe('42')
    // An `Event` handed to unhandledrejection used to log as "[object Event]".
    const d = describeError({ type: 'error', isTrusted: true })
    expect(d.message).not.toBe('[object Object]')
    expect(d.message).not.toBe('Unknown error')
  })

  test('a whole { data, error } response is unwrapped to its error', () => {
    const d = describeError({ data: null, error: { message: 'JWT expired', code: 'PGRST301' } })
    expect(d).toMatchObject({ message: 'JWT expired', code: 'PGRST301' })
  })

  test('caps the message so a runaway string cannot blow the row', () => {
    expect(describeError(new Error('x'.repeat(5000))).message).toHaveLength(1000)
  })
})

describe('classifiers', () => {
  test('network: WebKit "Load failed", Chrome "Failed to fetch", timeouts', () => {
    expect(isNetworkError(new TypeError('Load failed'))).toBe(true)
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkError(new DOMException('aborted', 'AbortError'))).toBe(true)
    expect(isNetworkError({ message: 'permission denied', code: '42501' })).toBe(false)
  })

  test('clock skew is the one "JWT" failure a refresh cannot fix', () => {
    expect(isClockSkew({ message: 'JWT issued at future' })).toBe(true)
    expect(isAuthStale({ message: 'JWT expired', code: 'PGRST301' })).toBe(true)
    expect(isAuthStale({ message: 'JWT issued at future' })).toBe(false)
  })

  test('permission denied covers RLS refusals', () => {
    expect(isPermissionDenied({ message: 'new row violates row-level security policy for table "availability"' })).toBe(true)
    expect(isPermissionDenied({ code: '42501', message: 'permission denied' })).toBe(true)
  })
})

describe('friendlyError — club-voice copy a player can act on', () => {
  test.each([
    [new TypeError('Load failed'), /check your signal/],
    [{ message: 'JWT issued at future' }, /clock/],
    [{ message: 'JWT expired', code: 'PGRST301' }, /sign out and back in/],
    [{ message: 'new row violates row-level security policy' }, /not allowed/],
    [{ message: 'duplicate key value violates unique constraint', code: '23505' }, /duplicate/],
    [{ message: 'Invalid login credentials' }, /wrong email or password/i],
    [{ message: 'User already registered' }, /already an account/],
    [{ message: 'Too many requests', status: 429 }, /minute/],
    [{ message: 'The object exceeded the maximum allowed size', status: 413 }, /too big/],
    [{ message: 'Internal error', status: 500 }, /wobble/],
  ])('%o → %s', (err, re) => {
    expect(friendlyError(err)).toMatch(re)
  })

  test('falls back to the caller copy, then the raw message, never to nothing', () => {
    expect(friendlyError({ message: 'weird thing' }, "Couldn't save that.")).toBe("Couldn't save that.")
    expect(friendlyError({ message: 'weird thing' })).toBe('weird thing')
    expect(friendlyError(null)).toMatch(/something went wrong/i)
  })

  test('never uses Americanisms', () => {
    const all = [new TypeError('Load failed'), { message: 'JWT expired' }, { code: '23505', message: '' }, { status: 500, message: 'x' }, null]
      .map((e) => friendlyError(e)).join(' ')
    expect(all).not.toMatch(/schedule|roster|soccer|field/i)
  })
})
