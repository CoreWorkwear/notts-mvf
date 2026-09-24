import { describe, test, expect, vi } from 'vitest'
import { mkLog, scrub, newRequestId } from './log.js'

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
