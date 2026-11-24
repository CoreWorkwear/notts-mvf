// Raw-byte Stripe Connect verification and dependency-injected delivery handler.
// No redirect, browser identity, provider fee or payout can create a receipt here.
export class WebhookError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}

const supportedEvents = new Set([
  'payment_intent.succeeded', 'payment_intent.processing', 'payment_intent.payment_failed', 'payment_intent.canceled',
  'checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired',
  'refund.created', 'refund.updated', 'refund.failed',
])

export async function verifyStripeConnectSignature(raw, header, secret, {
  crypto = globalThis.crypto, nowSeconds = Date.now() / 1000, toleranceSeconds = 300,
} = {}) {
  if (Object.prototype.toString.call(raw) !== '[object Uint8Array]' || typeof header !== 'string' || !secret?.startsWith('whsec_')) {
    throw new WebhookError('Stripe signature verification failed.')
  }
  const parts = header.split(',').map(part => part.trim().split('='))
  const timestamps = parts.filter(([name]) => name === 't')
  const signatures = parts.filter(([name, value, extra]) => name === 'v1' && !extra && /^[a-f0-9]{64}$/i.test(value ?? ''))
  const timestamp = timestamps[0]?.[1]
  if (timestamps.length !== 1 || timestamps[0].length !== 2 || !/^\d+$/.test(timestamp ?? '') ||
      !Number.isSafeInteger(Number(timestamp)) || !Number.isFinite(nowSeconds) ||
      Math.abs(nowSeconds - Number(timestamp)) > toleranceSeconds || !signatures.length) {
    throw new WebhookError('Stripe signature verification failed.')
  }
  const prefix = new TextEncoder().encode(`${timestamp}.`)
  const input = new Uint8Array(prefix.length + raw.length)
  input.set(prefix); input.set(raw, prefix.length)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, input))
  let matched = 0
  for (const [, signature] of signatures) {
    let different = 0
    for (let i = 0; i < expected.length; i++) different |= expected[i] ^ Number.parseInt(signature.slice(i * 2, i * 2 + 2), 16)
    matched |= Number(different === 0)
  }
  if (!matched) throw new WebhookError('Stripe signature verification failed.')
}

export async function handleStripeConnectWebhook(req, {
  secret, platformAccountId, mode, settle, recordPayout, crypto = globalThis.crypto, nowSeconds,
  maxBodyBytes = 1024 * 1024,
}) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)
  if (!secret?.startsWith('whsec_') || !/^acct_[A-Za-z0-9]+$/.test(platformAccountId ?? '') || !['test', 'live'].includes(mode)) {
    return json({ error: 'Webhook is not configured.' }, 503)
  }
  try {
    if (Number(req.headers.get('Content-Length')) > maxBodyBytes) throw new WebhookError('Webhook body is too large.', 413)
    const raw = new Uint8Array(await req.arrayBuffer())
    if (raw.length > maxBodyBytes) throw new WebhookError('Webhook body is too large.', 413)
    await verifyStripeConnectSignature(raw, req.headers.get('Stripe-Signature'), secret, { crypto, nowSeconds })
    // Parsing occurs ONLY after signature/timestamp verification of exact bytes.
    let event
    try { event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) }
    catch { throw new WebhookError('Invalid Stripe event JSON.') }
    if (!event || !/^evt_[A-Za-z0-9]+$/.test(event.id ?? '') || typeof event.type !== 'string' ||
        !/^acct_[A-Za-z0-9]+$/.test(event.account ?? '') || typeof event.livemode !== 'boolean' ||
        event.livemode !== (mode === 'live') || !Number.isSafeInteger(event.created) || event.created < 0 ||
        !event.data?.object || typeof event.data.object !== 'object' || Array.isArray(event.data.object)) {
      throw new WebhookError('Invalid Stripe Connect event scope.')
    }
    const payoutEvent = ['payout.paid', 'payout.failed'].includes(event.type)
    if (!payoutEvent && !supportedEvents.has(event.type)) return json({ received: true, outcome: 'ignored' })
    const result = payoutEvent ? await recordPayout(platformAccountId, event) : await settle(platformAccountId, event)
    return json({ received: true, outcome: result.outcome })
  } catch (error) {
    if (error instanceof WebhookError) return json({ error: error.message }, error.status)
    // Unknown attempts/original success and transient storage failures MUST
    // remain non-2xx so Stripe retries. Never expose raw payloads or DB details.
    return json({ error: 'Stripe event could not be processed. Please retry.' }, 503)
  }
}
