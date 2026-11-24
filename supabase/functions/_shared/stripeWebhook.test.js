import { createHmac, webcrypto } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { handleStripeConnectWebhook, verifyStripeConnectSignature, WebhookError } from './stripeWebhook.js'

const now = 1795521600
const secret = 'whsec_syntheticOnly'
const envelope = (overrides = {}) => ({
  id: 'evt_success', type: 'payment_intent.succeeded', account: 'acct_connected', livemode: false, created: now,
  data: { object: { id: 'pi_one', object: 'payment_intent', livemode: false, amount: 900, amount_received: 900,
    currency: 'gbp', status: 'succeeded', customer: 'cus_player', metadata: { attempt_id: 'own-attempt' } } },
  ...overrides,
})
function signature(raw, timestamp = now, signingSecret = secret) {
  return `t=${timestamp},v1=${createHmac('sha256', signingSecret).update(`${timestamp}.`).update(raw).digest('hex')}`
}
function request(raw, header = signature(raw), extras = {}) {
  return new Request('https://club.example/functions/v1/stripe-connect-webhook', {
    method: 'POST', body: raw, headers: { 'Stripe-Signature': header, ...extras },
  })
}
function harness(extra = {}) {
  const settle = vi.fn(async () => ({ outcome: 'succeeded', receipt_entry_id: 'private-ledger-id' }))
  const handle = req => handleStripeConnectWebhook(req, {
    secret, platformAccountId: 'acct_platform', mode: 'test', crypto: webcrypto, nowSeconds: now, settle, ...extra,
  })
  return { handle, settle }
}

describe('Connect raw signature verification', () => {
  it('agrees with independent HMAC on exact UTF-8 bytes including whitespace', async () => {
    const raw = new TextEncoder().encode('{ "reason": "Training £4 ⚽" }\n')
    await expect(verifyStripeConnectSignature(raw, signature(raw), secret, { crypto: webcrypto, nowSeconds: now })).resolves.toBeUndefined()
    await expect(verifyStripeConnectSignature(new TextEncoder().encode('{"reason":"Training £4 ⚽"}'), signature(raw), secret,
      { crypto: webcrypto, nowSeconds: now })).rejects.toThrow('signature')
  })

  it('accepts any matching v1 during rotation, ignoring v0', async () => {
    const raw = new TextEncoder().encode('{}')
    const header = `t=${now},v0=ignored,v1=${'0'.repeat(64)},${signature(raw).split(',')[1]}`
    await expect(verifyStripeConnectSignature(raw, header, secret, { crypto: webcrypto, nowSeconds: now })).resolves.toBeUndefined()
  })

  it.each([
    undefined, '', `t=${now}`, `t=${now},v1=bad`, `t=${now},t=${now},v1=${'0'.repeat(64)}`,
    `t=bad,v1=${'0'.repeat(64)}`, `t=${now},v1=${'f'.repeat(64)}`, `t=${now},v1=${'f'.repeat(63)}`,
  ])('rejects malformed or missing signature %s', async header => {
    await expect(verifyStripeConnectSignature(new TextEncoder().encode('{}'), header, secret,
      { crypto: webcrypto, nowSeconds: now })).rejects.toThrow('signature')
  })

  it.each([-301, 301])('rejects replay or future timestamp outside tolerance (%i)', async offset => {
    const raw = new TextEncoder().encode('{}')
    await expect(verifyStripeConnectSignature(raw, signature(raw, now + offset), secret,
      { crypto: webcrypto, nowSeconds: now })).rejects.toThrow('signature')
  })

  it('rejects a different endpoint secret', async () => {
    const raw = new TextEncoder().encode('{}')
    await expect(verifyStripeConnectSignature(raw, signature(raw, now, 'whsec_wrong'), secret,
      { crypto: webcrypto, nowSeconds: now })).rejects.toThrow('signature')
  })
})

describe('Connect delivery handler', () => {
  it('verifies before JSON parsing and never touches settlement for forged input', async () => {
    const h = harness()
    const parse = vi.spyOn(JSON, 'parse')
    const response = await h.handle(request('not json', `t=${now},v1=${'0'.repeat(64)}`))
    expect(response.status).toBe(400)
    expect(parse).not.toHaveBeenCalled()
    parse.mockRestore()
    expect(h.settle).not.toHaveBeenCalled()
  })

  it('refuses signed malformed JSON before settlement', async () => {
    const h = harness()
    expect((await h.handle(request('not json'))).status).toBe(400)
    expect(h.settle).not.toHaveBeenCalled()
  })

  it.each([
    { livemode: true }, { account: undefined }, { account: 'not-connected' }, { id: 'bad' },
    { created: 1.25 }, { data: { object: null } }, { data: { object: [] } },
  ])('rejects signed scope/envelope mismatch %j', async override => {
    const h = harness()
    expect((await h.handle(request(JSON.stringify(envelope(override))))).status).toBe(400)
    expect(h.settle).not.toHaveBeenCalled()
  })

  it('passes independently verified full event and configured platform, exposes no private ledger ID', async () => {
    const h = harness()
    const event = envelope()
    const response = await h.handle(request(JSON.stringify(event)))
    expect(response.status).toBe(200)
    expect(h.settle).toHaveBeenCalledWith('acct_platform', event)
    expect(await response.json()).toEqual({ received: true, outcome: 'succeeded' })
  })

  it('accepts live mode only at its explicitly configured live endpoint', async () => {
    const h = harness({ mode: 'live' })
    expect((await h.handle(request(JSON.stringify(envelope({ livemode: true }))))).status).toBe(200)
    expect(h.settle).toHaveBeenCalledOnce()
  })

  it.each(['payment_intent.processing', 'payment_intent.payment_failed', 'payment_intent.canceled',
    'checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed',
    'checkout.session.expired', 'refund.created', 'refund.updated', 'refund.failed'])('routes signed %s to transactional verification', async type => {
    const h = harness()
    expect((await h.handle(request(JSON.stringify(envelope({ type }))))).status).toBe(200)
    expect(h.settle).toHaveBeenCalledOnce()
  })

  it('ignores payouts and unrelated event types without any storage/financial call', async () => {
    const h = harness()
    const response = await h.handle(request(JSON.stringify(envelope({ type: 'payout.paid' }))))
    expect(await response.json()).toEqual({ received: true, outcome: 'ignored' })
    expect(h.settle).not.toHaveBeenCalled()
  })

  it('returns retryable non-2xx for unknown attempts, missing original success and storage interruption', async () => {
    const h = harness()
    h.settle.mockRejectedValue(new Error('private DB details or P0002'))
    const response = await h.handle(request(JSON.stringify(envelope())))
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('private DB')
  })

  it('returns non-2xx on verified financial mismatch without exposing internals', async () => {
    const h = harness()
    h.settle.mockRejectedValue(new WebhookError('Stripe payment details could not be verified.'))
    expect((await h.handle(request(JSON.stringify(envelope())))).status).toBe(400)
  })

  it.each([{ secret: '' }, { platformAccountId: '' }, { mode: 'sandbox' }])('requires explicit endpoint configuration %j', async config => {
    const h = harness(config)
    expect((await h.handle(request(JSON.stringify(envelope())))).status).toBe(503)
    expect(h.settle).not.toHaveBeenCalled()
  })

  it('bounds raw body size and rejects other methods', async () => {
    const h = harness({ maxBodyBytes: 4 })
    expect((await h.handle(request('12345'))).status).toBe(413)
    expect((await h.handle(new Request('https://club.example', { method: 'GET' }))).status).toBe(405)
    expect(h.settle).not.toHaveBeenCalled()
  })
})
