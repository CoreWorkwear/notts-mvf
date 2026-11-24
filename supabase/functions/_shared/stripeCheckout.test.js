import { describe, it, expect, vi } from 'vitest'
import { checkoutCallbacks, checkoutMetadata, createConnectedStripeClient, ensureCheckoutSession,
  ensureStripeCustomer, paymentQuote, runCheckoutAction, validateCheckoutAmount } from './stripeCheckout.js'

const id = '34df7387-0cba-4ccf-871a-21426c3c960a'
const now = Date.parse('2026-11-24T16:00:00Z')
const profile = { id: 'player-a', club_id: 'club-a', active: true, approved: true, is_player: true }
const connection = { club_id: 'club-a', platform_account_id: 'acct_platform', livemode: false,
  creation_id: 'connection', stripe_account_id: 'acct_club' }
const customerRow = { ...connection, profile_id: profile.id, creation_id: 'customer-creation',
  stripe_account_id: 'acct_club', created_at: new Date(now).toISOString(), stripe_customer_id: null }
const attempt = { id, ...connection, profile_id: profile.id, player_account_id: 'account-a', amount_pence: 900,
  kind: 'balance', currency: 'gbp', club_name: 'Notts MvF', status: 'creating',
  created_at: new Date(now).toISOString(), ...checkoutCallbacks('https://club.example', id) }
const customer = { id: 'cus_player', metadata: { club_id: 'club-a', profile_id: 'player-a',
  platform_account_id: 'acct_platform', provider_mode: 'test', customer_creation_id: 'customer-creation' } }
const session = { id: 'cs_test_attempt', customer: 'cus_player', client_reference_id: id,
  amount_total: 900, currency: 'gbp', livemode: false, mode: 'payment', status: 'open', payment_status: 'unpaid',
  url: 'https://checkout.stripe.com/c/pay/session', metadata: checkoutMetadata(attempt) }

function harness() {
  const stripe = vi.fn(async path => path === '/account' ? { id: 'acct_platform' } : {
    id: 'acct_club', charges_enabled: true, payouts_enabled: true,
    metadata: { club_id: 'club-a', platform_account_id: 'acct_platform', provider_mode: 'test', connection_creation_id: 'connection' },
  })
  const direct = vi.fn(async path => path.startsWith('/customers') ? customer : session)
  const connectedStripe = vi.fn(() => direct)
  const store = {
    connection: vi.fn(async () => connection), quote: vi.fn(async () => ({ balance_pence: -900, amount_pence: 900 })),
    reserve: vi.fn(async () => ({ attempt: { ...attempt }, customer: { ...customerRow } })),
    readAttempt: vi.fn(async () => ({ ...attempt, checkout_session_id: session.id, stripe_customer_id: customer.id, status: 'pending' })),
    saveCustomer: vi.fn(async () => {}), saveSession: vi.fn(async () => {}),
  }
  const run = (body = { action: 'start', attempt_id: id, kind: 'balance', amount_pence: 900 }, extras = {}) =>
    runCheckoutAction({ body, profile, enabled: true, mode: 'test', stripe, connectedStripe, store,
      appBaseUrl: 'https://club.example', now, ...extras })
  return { stripe, direct, connectedStripe, store, run }
}

describe('confirmed GBP payment quotes', () => {
  it.each([undefined, null, '900', 29, 0, -1, 30.1, Infinity, NaN, 100000000])('rejects unsupported amounts %s', value => {
    expect(() => validateCheckoutAmount(value)).toThrow()
  })
  it('allows exact minimum and positive whole-pence topups while settled/in credit', () => {
    expect(validateCheckoutAmount(30)).toBe(30)
    expect(paymentQuote({ amount_pence: 0, balance_pence: 400 }, 'top_up', 900)).toMatchObject({ can_pay: true, amount_pence: 900 })
    expect(paymentQuote({ amount_pence: 0, balance_pence: 0 }, 'top_up', 900)).toMatchObject({ can_pay: true })
  })
  it('quotes only exact debt and explains sub-minimum arrears without inflating the payment', () => {
    expect(paymentQuote({ balance_pence: -900, amount_pence: 900 }, 'balance')).toMatchObject({ amount_pence: 900, can_pay: true })
    expect(paymentQuote({ balance_pence: -15, amount_pence: 15 }, 'balance')).toMatchObject({ amount_pence: 15, can_pay: false })
    expect(paymentQuote({ balance_pence: 40, amount_pence: 0 }, 'balance')).toMatchObject({ amount_pence: 0, can_pay: false })
  })
  it('returns a changed balance quote as 409 before customer/session creation', async () => {
    const h = harness()
    h.store.reserve.mockResolvedValue({ stale: true, quote: { balance_pence: -1200, amount_pence: 1200 } })
    await expect(h.run()).rejects.toMatchObject({ status: 409, code: 'stale_quote', quote: { amount_pence: 1200 } })
    expect(h.direct).not.toHaveBeenCalled()
  })
})

describe('own player and provider scope', () => {
  it.each([{ ...profile, active: false }, { ...profile, approved: false }, { ...profile, is_player: false }])('blocks unauthorized creation before provider calls', async player => {
      const h = harness()
      await expect(h.run(undefined, { profile: player })).rejects.toMatchObject({ status: 403 })
      expect(h.stripe).not.toHaveBeenCalled()
    })
  it('blocks quote/start during pause but permits own existing status', async () => {
    const h = harness()
    await expect(h.run(undefined, { enabled: false })).rejects.toMatchObject({ status: 403 })
    expect(await h.run({ action: 'status', attempt_id: id }, { enabled: false, profile: { ...profile, active: false } }))
      .toEqual({ attempt_id: id, amount_pence: 900, currency: 'gbp', status: 'pending' })
  })
  it.each(['profile_id', 'club_id', 'platform_account_id', 'livemode'])('refuses status with mismatched %s', async field => {
    const h = harness()
    h.store.readAttempt.mockResolvedValue({ ...attempt, [field]: field === 'livemode' ? true : 'other' })
    await expect(h.run({ action: 'status', attempt_id: id })).rejects.toMatchObject({ status: 404 })
    expect(h.direct).not.toHaveBeenCalled()
  })
  it('rejects provider requirements/readiness changes before reserving an attempt', async () => {
    const h = harness()
    const original = h.stripe.getMockImplementation()
    h.stripe.mockImplementation(async path => ({ ...await original(path), payouts_enabled: false }))
    await expect(h.run()).rejects.toMatchObject({ code: 'not_ready' })
    expect(h.store.reserve).not.toHaveBeenCalled()
  })
  it('sends direct-charge calls with the verified connected account header', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    await createConnectedStripeClient('sk_test_placeholder', 'acct_club', fetcher)('/customers', { method: 'POST', body: {} })
    expect(fetcher).toHaveBeenCalledWith('https://api.stripe.com/v1/customers', expect.objectContaining({
      headers: expect.objectContaining({ 'Stripe-Account': 'acct_club' }),
    }))
  })
})

describe('durable hosted direct charge attempts', () => {
  it('enables only explicit on-session opt-in saving and consented redisplay on new v2 attempts', async () => {
    const direct = vi.fn(async () => session)
    await ensureCheckoutSession(direct, { ...attempt, checkout_options_version: 2 }, 'cus_player', now)
    const body = direct.mock.calls[0][1].body
    expect(body['saved_payment_method_options[payment_method_save]']).toBe('enabled')
    expect(body['saved_payment_method_options[allow_redisplay_filters][0]']).toBe('always')
    expect(body.mode).toBe('payment')
    expect(Object.keys(body).some(key => /setup_future_usage|off_session/.test(key))).toBe(false)
  })
  it('preserves the original idempotent body for old v1 attempts', async () => {
    const direct = vi.fn(async () => session)
    await ensureCheckoutSession(direct, { ...attempt, checkout_options_version: 1 }, 'cus_player', now)
    expect(Object.keys(direct.mock.calls[0][1].body).some(key => key.startsWith('saved_payment_method_options'))).toBe(false)
    expect(direct.mock.calls[0][1].idempotencyKey).toBe(`player-checkout:${id}`)
  })
  it('double taps produce exactly the same customer/session idempotency and agreed parameters', async () => {
    const h = harness()
    const results = await Promise.all([h.run(), h.run()])
    expect(results[0]).toEqual(results[1])
    const calls = h.direct.mock.calls.filter(([path]) => path === '/checkout/sessions')
    expect(calls[0]).toEqual(calls[1])
    const body = calls[0][1].body
    expect(calls[0][1].idempotencyKey).toBe(`player-checkout:${id}`)
    expect(body).toMatchObject({ customer: 'cus_player', mode: 'payment', ui_mode: 'hosted_page',
      'line_items[0][price_data][unit_amount]': '900', 'line_items[0][price_data][currency]': 'gbp',
      'metadata[attempt_id]': id, 'payment_intent_data[metadata][attempt_id]': id,
      'payment_intent_data[metadata][player_account_id]': 'account-a',
      'allowed_payment_method_types[0]': 'card', 'allowed_payment_method_types[1]': 'pay_by_bank' })
    expect(body.payment_intent_data).toBeUndefined()
    expect(Object.keys(body).some(key => /transfer_data|application_fee|setup_future_usage/.test(key))).toBe(false)
    expect(h.store.saveSession).toHaveBeenCalledWith(id, 'cus_player', session.id, session.url)
  })
  it('a provider-paid return remains pending until NOT-35 verifies and posts the credit', async () => {
    const h = harness()
    h.direct.mockResolvedValue({ ...session, payment_status: 'paid', status: 'complete', url: null })
    expect(await h.run({ action: 'status', attempt_id: id, payment_status: 'succeeded' })).toMatchObject({ status: 'pending' })
    expect(h.store.saveSession).not.toHaveBeenCalled()
  })
  it('returns server-verified success after pause without creating or polling another payment', async () => {
    const h = harness()
    h.store.readAttempt.mockResolvedValue({ ...attempt, status: 'succeeded', checkout_session_id: session.id })
    expect(await h.run({ action: 'status', attempt_id: id }, { enabled: false })).toMatchObject({ status: 'succeeded' })
    expect(h.direct).not.toHaveBeenCalled()
  })
  it.each(['amount_total', 'currency', 'customer', 'livemode', 'client_reference_id'])('refuses a returned session with changed %s', async field => {
    const h = harness()
    const original = h.direct.getMockImplementation()
    h.direct.mockImplementation(async path => path.startsWith('/checkout') ? { ...session,
      [field]: field === 'livemode' ? true : field === 'amount_total' ? 1000 : 'wrong' } : original(path))
    await expect(h.run()).rejects.toThrow('session verification failed')
    expect(h.store.saveSession).not.toHaveBeenCalled()
  })
  it('old uncertain customer/session reservations reconcile read-only instead of posting again', async () => {
    const old = new Date(now - 24 * 3600000).toISOString()
    const customerStripe = vi.fn(async () => ({ data: [customer], has_more: false }))
    expect(await ensureStripeCustomer(customerStripe, { ...customerRow, created_at: old }, vi.fn(), now)).toBe('cus_player')
    const checkoutStripe = vi.fn(async () => ({ data: [session], has_more: false }))
    expect((await ensureCheckoutSession(checkoutStripe, { ...attempt, created_at: old }, 'cus_player', now)).id).toBe(session.id)
    expect([...customerStripe.mock.calls, ...checkoutStripe.mock.calls].every(call => call.length === 1)).toBe(true)
  })
  it('fixed callbacks ignore caller redirect strings and unsafe links are rejected', async () => {
    expect(checkoutCallbacks('https://club.example/path', id)).toEqual({
      success_url: `https://club.example/you?payment_attempt=${id}&payment_status=return`,
      cancel_url: `https://club.example/you?payment_attempt=${id}&payment_status=cancelled`,
    })
    const h = harness()
    const original = h.direct.getMockImplementation()
    h.direct.mockImplementation(async path => path.startsWith('/checkout') ? { ...session,
      url: 'https://evil.example/checkout' } : original(path))
    await expect(h.run()).rejects.toThrow('invalid Checkout link')
    expect(() => checkoutCallbacks('https://user:pass@club.example', id)).toThrow()
  })
})
