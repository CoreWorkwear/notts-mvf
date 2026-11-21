import { describe, test, expect, vi } from 'vitest'
import { mkLog, scrub, scrubString, internalErrorBody, newRequestId } from './log.js'

function sink() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() }
}
const lastJson = (fn) => JSON.parse(fn.mock.calls.at(-1)[0])

describe('mkLog', () => {
  test('emits one JSON line per call carrying fn, id, level, event and the fields', () => {
    const s = sink()
    const log = mkLog('send-push', { method: 'POST' }, s)
    log.info('done', { caller: 'u1', targets: 3, sent: 2, pruned: 1, failed: { '4xx': 0, '5xx': 0, other: 0 }, ms: 12 })
    const rec = lastJson(s.log)
    expect(rec).toMatchObject({ fn: 'send-push', id: log.id, level: 'info', event: 'done', method: 'POST', caller: 'u1', targets: 3, sent: 2, pruned: 1, ms: 12 })
    expect(typeof rec.ts).toBe('string')
  })
  test('warn and error go to their own console channels', () => {
    const s = sink()
    const log = mkLog('run-reminders', null, s)
    log.warn('fixture_skipped', { reason: 'ledger_read_error' })
    log.error('unhandled', { message: 'x' })
    expect(lastJson(s.warn)).toMatchObject({ level: 'warn', event: 'fixture_skipped', reason: 'ledger_read_error' })
    expect(lastJson(s.error)).toMatchObject({ level: 'error', event: 'unhandled', message: 'x' })
    expect(s.log).not.toHaveBeenCalled()
  })
  test('every request gets a distinct id that is safe to return in a header', () => {
    const a = mkLog('f', null, sink()).id
    const b = mkLog('f', null, sink()).id
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9._-]{1,64}$/)
    expect(newRequestId()).toMatch(/^[A-Za-z0-9._-]{1,64}$/)
  })
  test('elapsed() is a non-negative ms count', () => {
    expect(mkLog('f', null, sink()).elapsed()).toBeGreaterThanOrEqual(0)
  })
})

describe('scrub — tokens and PII never reach a log line', () => {
  test('drops token / email / phone / name-ish keys, keeps ids and counts', () => {
    expect(scrub({ token: 'abc', pushToken: 'def', email: 'a@b', user_email: 'c@d', phone: '077', first_name: 'Jo', scorer_name: 'x', name: 'y', authorization: 'Bearer', cron_secret: 's', profileId: 'p1', sent: 2 }))
      .toEqual({ profileId: 'p1', sent: 2 })
  })
  test('the summary counts survive: tokens (a count) and tokenId (an id) are not tokens', () => {
    expect(scrub({ tokens: 4, tokenId: 't1', targets: 3 })).toEqual({ tokens: 4, tokenId: 't1', targets: 3 })
  })
  test('a logged field named token is dropped from the emitted line', () => {
    const s = sink()
    mkLog('f', null, s).info('x', { token: '{"endpoint":"https://push"}', count: 1 })
    const rec = lastJson(s.log)
    expect(rec.token).toBeUndefined()
    expect(rec.count).toBe(1)
  })
})

describe('scrub of values', () => {
  test('masks emails, JWTs and phone-like digit runs inside strings', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abc_DEF-123'
    expect(scrubString('dup key for jo.bloggs+x@example.co.uk here')).toBe('dup key for [email] here')
    expect(scrubString(`Bearer ${jwt} bad`)).toBe('Bearer [jwt] bad')
    expect(scrubString('call 07700 900 123 now')).toBe('call [phone] now')
    expect(scrubString('call +44 (0)7700-900123')).toBe('call [phone]')
    expect(scrubString('only 123456 digits')).toBe('only 123456 digits')
  })
  test('replaces a Failing row dump wholesale', () => {
    const msg = 'new row violates check constraint "x"\nDETAIL: Failing row contains (a1, Jo, Bloggs, jo@x.com, 07700900123).'
    const out = scrubString(msg)
    expect(out).toContain('Failing row contains ([redacted])')
    expect(out).not.toMatch(/Bloggs|jo@x|0770/)
  })
  test('leaves uuids (request ids) alone', () => {
    const id = '12345678-1234-1234-1234-123456789012'
    expect(scrubString(`target ${id}`)).toBe(`target ${id}`)
  })
  test('scrubs nested objects and arrays, and drops PII keys at depth', () => {
    const out = scrub({ a: { b: ['x@y.com', { email: 'q', note: 'ring 07700 900123' }] }, n: 3, ok: true })
    expect(out).toEqual({ a: { b: ['[email]', { note: 'ring [phone]' }] }, n: 3, ok: true })
  })
  test('an Error value is logged as its scrubbed message', () => {
    expect(scrub({ e: new Error('bad row a@b.co') })).toEqual({ e: 'bad row [email]' })
  })
  test('the emitted line is scrubbed', () => {
    const s = sink()
    mkLog('f', null, s).error('x', { message: 'Failing row contains (Jo, 07700900123)' })
    expect(lastJson(s.error).message).toBe('Failing row contains ([redacted])')
  })
})

describe('internalErrorBody', () => {
  test('is generic, carries the reference, and holds no exception text', () => {
    const b = internalErrorBody('req-1')
    expect(b).toEqual({ error: 'Something went wrong on our side. Quote this reference: req-1', requestId: 'req-1' })
  })
})
