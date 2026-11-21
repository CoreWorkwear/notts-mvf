import { describe, test, expect, vi } from 'vitest'
import { createECDH, randomBytes } from 'node:crypto'
import webpush from 'web-push'
import { deliverTrainingPush, sendTrainingPush, TRAINING_PUSH_BATCH, TRAINING_PUSH_CONCURRENCY, TRAINING_PUSH_TIMEOUT_MS } from './trainingPush.js'

const subscription = (suffix = 'ok') => ({ endpoint: 'https://fcm.googleapis.com/' + suffix, keys: { p256dh: 'test', auth: 'test' } })
const row = (id = 'n1', extra = {}) => ({
  id, lease_token: 'lease-' + id, device_token: subscription(id),
  title: 'Training moved', body: 'Now at 19:00. Update your availability.',
  tag: 'training-notice1', url: '/training?session=s1', can_reply: true, ...extra,
})
const deps = (rows) => ({
  claim: vi.fn(async () => ({ data: rows, error: null })),
  finish: vi.fn(async () => ({ data: true, error: null })),
  send: vi.fn(async () => {}),
})

describe('training outbox delivery', () => {
  test('claims one bounded batch and preserves event deep link/tag with no fixture actions', async () => {
    const d = deps([row(), row('n2', { title: 'Training cancelled', body: 'Cancelled.', can_reply: false })])
    expect(await deliverTrainingPush(d)).toEqual({ claimed: 2, sent: 2, failed: 0, finishFailed: 0 })
    expect(d.claim).toHaveBeenCalledOnce()
    expect(d.claim).toHaveBeenCalledWith(TRAINING_PUSH_BATCH)
    const payloads = d.send.mock.calls.map(call => JSON.parse(call[1]))
    expect(payloads[0]).toEqual({ title: 'Training moved', body: 'Now at 19:00. Update your availability.', tag: 'training-notice1', url: '/training?session=s1', kind: 'training', canReply: true })
    expect(payloads[1]).toMatchObject({ title: 'Training cancelled', body: 'Cancelled.', canReply: false })
    expect(payloads.every(p => !p.withAvailability && !p.actions && !p.fixtureId)).toBe(true)
    expect(d.finish).toHaveBeenCalledWith('n1', 'lease-n1', true, null)
  })

  test('claim read failures fail closed and an empty queue never sends', async () => {
    const d = deps([])
    expect(await deliverTrainingPush(d)).toEqual({ claimed: 0, sent: 0, failed: 0, finishFailed: 0 })
    d.claim.mockResolvedValue({ data: null, error: { message: 'database down' } })
    await expect(deliverTrainingPush(d)).rejects.toThrow('claim failed')
    expect(d.send).not.toHaveBeenCalled()
    expect(d.finish).not.toHaveBeenCalled()
  })

  test('invalid/SSRF subscriptions are never contacted; permanent and transient errors remain distinct', async () => {
    const d = deps([
      row('bad', { device_token: { ...subscription(), endpoint: 'https://169.254.169.254/' } }),
      row('gone'), row('down'), row('rate'), row('network'), row('okay'),
    ])
    d.send.mockImplementation(async sub => {
      if (sub.endpoint.endsWith('gone')) throw { statusCode: 410, endpoint: 'private', body: 'secret' }
      if (sub.endpoint.endsWith('down')) throw { statusCode: 503 }
      if (sub.endpoint.endsWith('rate')) throw { statusCode: 429 }
      if (sub.endpoint.endsWith('network')) throw new Error('secret subscription URL')
    })
    expect(await deliverTrainingPush(d)).toEqual({ claimed: 6, sent: 1, failed: 5, finishFailed: 0 })
    expect(d.send).toHaveBeenCalledTimes(5)
    for (const [id, reason] of [['bad', 'invalid_subscription'], ['gone', 'subscription_gone'], ['down', 'push_5xx'], ['rate', 'push_4xx'], ['network', 'push_other']]) {
      expect(d.finish).toHaveBeenCalledWith(id, 'lease-' + id, false, reason)
    }
    expect(JSON.stringify(d.finish.mock.calls)).not.toContain('secret')
  })

  test('concurrency is bounded and each row has exactly one outcome, without in-request retries', async () => {
    const d = deps(Array.from({ length: TRAINING_PUSH_BATCH }, (_, i) => row('n' + i)))
    let active = 0
    let peak = 0
    d.send.mockImplementation(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 1))
      active--
    })
    await deliverTrainingPush(d)
    expect(peak).toBe(TRAINING_PUSH_CONCURRENCY)
    expect(d.send).toHaveBeenCalledTimes(TRAINING_PUSH_BATCH)
    expect(new Set(d.finish.mock.calls.map(call => call[0])).size).toBe(TRAINING_PUSH_BATCH)
  })

  test('failed or stale acknowledgements are counted without resending or aborting other rows', async () => {
    const d = deps([row('a'), row('b'), row('c'), row('d')])
    d.finish.mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'unavailable' } })
      .mockRejectedValueOnce(new Error('connection lost'))
    expect(await deliverTrainingPush(d)).toEqual({ claimed: 4, sent: 4, failed: 0, finishFailed: 3 })
    expect(d.send).toHaveBeenCalledTimes(4)
    expect(d.finish).toHaveBeenCalledTimes(4)
  })
})

describe('abortable Web Push transport', () => {
  test('the installed web-push library creates real encrypted/VAPID request details without contacting a provider', async () => {
    const device = createECDH('prime256v1')
    device.generateKeys()
    const sub = {
      endpoint: 'https://fcm.googleapis.com/synthetic-device',
      keys: { p256dh: device.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
    }
    const keys = webpush.generateVAPIDKeys()
    const payload = JSON.stringify({ title: 'Training cancelled', url: '/training?session=synthetic' })
    const fetch_ = vi.fn(async (_endpoint, options) => {
      expect(options.method).toBe('POST')
      expect(options.headers['Content-Encoding']).toBe('aes128gcm')
      expect(options.headers.Authorization).toMatch(/^vapid /)
      expect(Buffer.from(options.body).includes(Buffer.from('Training cancelled'))).toBe(false)
      return { ok: true }
    })
    await sendTrainingPush(sub, payload, {
      generateRequestDetails: (subscription, body, options) => webpush.generateRequestDetails(subscription, body, {
        ...options, vapidDetails: { subject: 'mailto:synthetic@example.invalid', publicKey: keys.publicKey, privateKey: keys.privateKey },
      }),
      fetch: fetch_,
    })
    expect(fetch_).toHaveBeenCalledOnce()
  })

  test('uses encrypted request details, a full deadline, no redirects and cancels the response body', async () => {
    const details = { endpoint: subscription().endpoint, method: 'POST', headers: { Authorization: 'vapid' }, body: new Uint8Array([1, 2]) }
    const cancel = vi.fn(async () => {})
    const generateRequestDetails = vi.fn(() => details)
    const fetch_ = vi.fn(async () => ({ ok: true, body: { cancel } }))
    await sendTrainingPush(subscription(), '{}', { generateRequestDetails, fetch: fetch_ })
    expect(generateRequestDetails).toHaveBeenCalledWith(subscription(), '{}', { TTL: 3600, urgency: 'high' })
    expect(fetch_).toHaveBeenCalledWith(details.endpoint, { method: 'POST', headers: details.headers, body: details.body, redirect: 'error', signal: expect.any(AbortSignal) })
    expect(TRAINING_PUSH_TIMEOUT_MS).toBeLessThanOrEqual(8_000)
    expect(cancel).toHaveBeenCalledOnce()
  })

  test('provider status, timeout and encryption failure reject; provider text is never read', async () => {
    const generateRequestDetails = vi.fn(() => ({ endpoint: subscription().endpoint, method: 'POST' }))
    const text = vi.fn()
    const fetch_ = vi.fn(async () => ({ ok: false, status: 410, text }))
    await expect(sendTrainingPush(subscription(), '{}', { generateRequestDetails, fetch: fetch_ })).rejects.toEqual({ statusCode: 410 })
    expect(text).not.toHaveBeenCalled()
    fetch_.mockRejectedValueOnce(new Error('Timeout'))
    await expect(sendTrainingPush(subscription(), '{}', { generateRequestDetails, fetch: fetch_ })).rejects.toThrow('Timeout')
    generateRequestDetails.mockImplementation(() => { throw new Error('bad key') })
    await expect(sendTrainingPush(subscription(), '{}', { generateRequestDetails, fetch: fetch_ })).rejects.toThrow('bad key')
    expect(fetch_).toHaveBeenCalledTimes(2)
  })
})
