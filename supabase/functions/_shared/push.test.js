import { describe, test, expect, vi } from 'vitest'
import { parseSubscription, classifyPushError, pushToTokens } from './push.js'

const good = (endpoint) => JSON.stringify({ endpoint, keys: { p256dh: 'x', auth: 'y' } })
const noFail = { '4xx': 0, '5xx': 0, other: 0 }

describe('parseSubscription', () => {
  test('valid JSON with an endpoint parses; junk, non-objects and endpoint-less blobs are corrupt', () => {
    expect(parseSubscription(good('https://push.example/abc')).sub.endpoint).toBe('https://push.example/abc')
    expect(parseSubscription('not json')).toEqual({ corrupt: true })
    expect(parseSubscription('"a string"')).toEqual({ corrupt: true })
    expect(parseSubscription('{"keys":{}}')).toEqual({ corrupt: true })
    expect(parseSubscription(null)).toEqual({ corrupt: true })
  })
})

describe('classifyPushError', () => {
  test('404/410 prune; other 4xx and 5xx are counted by class and kept', () => {
    expect(classifyPushError({ statusCode: 410 })).toEqual({ prune: true, klass: 'gone' })
    expect(classifyPushError({ statusCode: 404 })).toEqual({ prune: true, klass: 'gone' })
    expect(classifyPushError({ statusCode: 401 })).toEqual({ prune: false, klass: '4xx' })
    expect(classifyPushError({ statusCode: 429 })).toEqual({ prune: false, klass: '4xx' })
    expect(classifyPushError({ statusCode: 503 })).toEqual({ prune: false, klass: '5xx' })
    expect(classifyPushError(new Error('ECONNRESET'))).toEqual({ prune: false, klass: 'other' })
  })
})

describe('pushToTokens', () => {
  test('counts sent / pruned / failed-by-class and prunes only dead subscriptions', async () => {
    const send = vi.fn(async (sub) => {
      if (sub.endpoint.endsWith('/gone')) throw { statusCode: 410 }
      if (sub.endpoint.endsWith('/down')) throw { statusCode: 502 }
      if (sub.endpoint.endsWith('/vapid')) throw { statusCode: 403 }
    })
    const prune = vi.fn(async () => {})
    const tokens = [
      { id: 't1', token: good('https://p/ok') },
      { id: 't2', token: good('https://p/gone') },
      { id: 't3', token: good('https://p/down') },
      { id: 't4', token: good('https://p/vapid') },
    ]
    const out = await pushToTokens(tokens, '{"title":"x"}', { send, prune })
    expect(out).toEqual({ attempted: 4, sent: 1, pruned: 1, failed: { '4xx': 1, '5xx': 1, other: 0 } })
    expect(prune.mock.calls.map((c) => c[0])).toEqual(['t2'])
    expect(send).toHaveBeenCalledTimes(4)
  })

  // Finding B — old code: JSON.parse threw inside the try, the catch saw no
  // statusCode, the row stayed, and the same throw repeated every run forever.
  test('a corrupt token is pruned, never sent, not retried forever', async () => {
    const send = vi.fn(async () => {})
    const prune = vi.fn(async () => {})
    const out = await pushToTokens([{ id: 'bad', token: '{not json' }, { id: 'ok', token: good('https://p/ok') }], '{}', { send, prune })
    expect(out).toEqual({ attempted: 2, sent: 1, pruned: 1, failed: noFail })
    expect(prune).toHaveBeenCalledWith('bad')
    expect(send).toHaveBeenCalledTimes(1)
  })

  test('a prune that itself fails does not abort the batch', async () => {
    const send = vi.fn(async () => { throw { statusCode: 404 } })
    const prune = vi.fn(async () => { throw new Error('db down') })
    const out = await pushToTokens([{ id: 't1', token: good('https://p/a') }], '{}', { send, prune })
    expect(out).toEqual({ attempted: 1, sent: 0, pruned: 1, failed: noFail })
  })

  test('an empty token list is a zero result', async () => {
    expect(await pushToTokens([], '{}', { send: vi.fn(), prune: vi.fn() })).toEqual({ attempted: 0, sent: 0, pruned: 0, failed: noFail })
  })
})
