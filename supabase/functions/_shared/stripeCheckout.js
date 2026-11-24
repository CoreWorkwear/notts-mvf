import { ConnectError, assertAccountScope, createStripeClient } from './stripeConnect.js'

export const MIN_CHECKOUT_PENCE = 30
export const MAX_CHECKOUT_PENCE = 99999999
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class CheckoutError extends ConnectError {
  constructor(message, status = 400, code = 'invalid_payment', quote) {
    super(message, status); this.code = code; this.quote = quote
  }
}

export function createConnectedStripeClient(secret, accountId, fetcher = fetch) {
  if (!/^acct_[A-Za-z0-9]+$/.test(accountId ?? '')) throw new ConnectError('Payment account verification failed.')
  return createStripeClient(secret, (url, options) => fetcher(url, {
    ...options, headers: { ...options.headers, 'Stripe-Account': accountId },
  }))
}

export function validateCheckoutAmount(amount) {
  if (!Number.isSafeInteger(amount) || amount < MIN_CHECKOUT_PENCE || amount > MAX_CHECKOUT_PENCE) {
    throw new CheckoutError('Enter a whole-pence GBP amount of at least £0.30 within the supported limit.')
  }
  return amount
}

export function checkoutCallbacks(base, attemptId) {
  let origin
  try { origin = new URL(base) } catch { throw new ConnectError('Payments are not configured.') }
  if (origin.username || origin.password || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) throw new ConnectError('Payments are not configured.')
  const url = new URL('/you', origin)
  url.searchParams.set('payment_attempt', attemptId)
  url.searchParams.set('payment_status', 'return')
  const success_url = url.href
  url.searchParams.set('payment_status', 'cancelled')
  return { success_url, cancel_url: url.href }
}

export function paymentQuote(balanceQuote, kind, requested, ready = true) {
  if (!['balance', 'top_up'].includes(kind)) throw new CheckoutError('Choose pay balance or add money.')
  const amount = kind === 'balance' ? Number(balanceQuote.amount_pence) : requested
  const balance = Number(balanceQuote.balance_pence)
  const supported = Number.isSafeInteger(amount) && amount >= MIN_CHECKOUT_PENCE && amount <= MAX_CHECKOUT_PENCE
  return { ready, can_pay: ready && supported, kind, amount_pence: amount, balance_pence: balance,
    min_amount_pence: MIN_CHECKOUT_PENCE, max_amount_pence: MAX_CHECKOUT_PENCE, currency: 'gbp',
    ...(!supported ? { reason: kind === 'balance' && amount === 0 ? 'There is no balance to pay.'
      : 'Online payments must be at least £0.30 and within the supported limit. Choose Add money to authorise a different amount.' } : {}),
  }
}

function customerMetadata(row) {
  return { club_id: row.club_id, profile_id: row.profile_id, platform_account_id: row.platform_account_id,
    provider_mode: row.livemode ? 'live' : 'test', customer_creation_id: row.creation_id }
}
export function checkoutMetadata(attempt) {
  return { club_id: attempt.club_id, profile_id: attempt.profile_id, player_account_id: attempt.player_account_id,
    attempt_id: attempt.id, platform_account_id: attempt.platform_account_id, provider_mode: attempt.livemode ? 'live' : 'test' }
}
function metadataMatches(object, expected) {
  return Object.entries(expected).every(([key, value]) => object?.metadata?.[key] === value)
}
function validAge(created, now) {
  const age = now - Date.parse(created)
  return Number.isFinite(age) && age >= 0 && age < 23 * 3600000
}

async function findOne(stripe, resource, metadata, extra = {}) {
  let after, found
  do {
    const query = new URLSearchParams({ limit: '100', ...extra, ...(after ? { starting_after: after } : {}) })
    const page = await stripe(`/${resource}?${query}`)
    if (!Array.isArray(page.data)) throw new ConnectError('Stripe returned an invalid response.')
    for (const object of page.data) {
      if (!metadataMatches(object, metadata)) continue
      if (found) throw new ConnectError('This payment needs support to recover its provider reference.')
      found = object
    }
    after = page.has_more ? page.data.at(-1)?.id : null
    if (page.has_more && !after) throw new ConnectError('Stripe returned an invalid response.')
  } while (after)
  if (!found) throw new ConnectError('This payment needs support to recover its provider reference.')
  return found
}

export async function ensureStripeCustomer(stripe, row, save, now = Date.now()) {
  const expected = customerMetadata(row)
  let customer
  if (row.stripe_customer_id) customer = await stripe(`/customers/${encodeURIComponent(row.stripe_customer_id)}`)
  else if (!validAge(row.created_at, now)) customer = await findOne(stripe, 'customers', expected)
  else {
    const body = Object.fromEntries(Object.entries(expected).map(([key, value]) => [`metadata[${key}]`, value]))
    customer = await stripe('/customers', { method: 'POST', body, idempotencyKey: `player-customer:${row.creation_id}` })
  }
  if (!/^cus_[A-Za-z0-9]+$/.test(customer?.id ?? '') || customer.deleted || !metadataMatches(customer, expected) ||
    (row.stripe_customer_id && row.stripe_customer_id !== customer.id)) throw new ConnectError('Payment customer verification failed.')
  await save(row.creation_id, customer.id)
  return customer.id
}

export function assertCheckoutSession(session, attempt, customerId) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(session?.id ?? '') ||
    (attempt.checkout_session_id && session.id !== attempt.checkout_session_id) ||
    session.client_reference_id !== attempt.id || session.customer !== customerId || session.currency !== 'gbp' ||
    session.amount_total !== attempt.amount_pence || session.livemode !== attempt.livemode || session.mode !== 'payment' ||
    !metadataMatches(session, checkoutMetadata(attempt))) throw new ConnectError('Payment session verification failed.')
}

export async function ensureCheckoutSession(stripe, attempt, customerId, now = Date.now()) {
  let session
  if (attempt.checkout_session_id) session = await stripe(`/checkout/sessions/${encodeURIComponent(attempt.checkout_session_id)}`)
  else if (!validAge(attempt.created_at, now)) {
    session = await findOne(stripe, 'checkout/sessions', checkoutMetadata(attempt), { customer: customerId })
  } else {
    const body = {
      mode: 'payment', ui_mode: 'hosted_page', customer: customerId, client_reference_id: attempt.id,
      success_url: attempt.success_url, cancel_url: attempt.cancel_url,
      'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'gbp',
      'line_items[0][price_data][unit_amount]': String(attempt.amount_pence),
      'line_items[0][price_data][product_data][name]': `${attempt.club_name.slice(0, 150)} — Club account payment`,
      // Filter Dashboard-enabled eligible methods. Card wallets are hosted by
      // Stripe; Pay by Bank is offered only when Stripe considers it eligible.
      'allowed_payment_method_types[0]': 'card', 'allowed_payment_method_types[1]': 'pay_by_bank',
      expires_at: String(Math.floor(Date.parse(attempt.created_at) / 1000) + 24 * 3600),
    }
    if (attempt.checkout_options_version === 2) {
      body['saved_payment_method_options[payment_method_save]'] = 'enabled'
      body['saved_payment_method_options[allow_redisplay_filters][0]'] = 'always'
    }
    for (const [key, value] of Object.entries(checkoutMetadata(attempt))) {
      body[`metadata[${key}]`] = value
      body[`payment_intent_data[metadata][${key}]`] = value
    }
    session = await stripe('/checkout/sessions', { method: 'POST', body, idempotencyKey: `player-checkout:${attempt.id}` })
  }
  assertCheckoutSession(session, attempt, customerId)
  return session
}

function attemptResult(attempt, session) {
  // A paid provider session awaiting the verified webhook is still pending in
  // the posted statement. Redirect query parameters never set these fields.
  const status = attempt.status === 'succeeded' ? 'succeeded'
    : attempt.status === 'failed' ? 'failed' : attempt.status === 'expired' || session?.status === 'expired' ? 'expired' : 'pending'
  return { attempt_id: attempt.id, amount_pence: attempt.amount_pence, currency: 'gbp', status }
}

export async function runCheckoutAction({ body, profile, enabled, mode, stripe, connectedStripe, store, appBaseUrl, now }) {
  const action = body?.action
  if (!['quote', 'start', 'status'].includes(action)) throw new CheckoutError('Choose a valid payment action.')
  if (!profile?.id || !profile.club_id) throw new CheckoutError('Player payments access refused.', 403, 'forbidden')
  if (action !== 'status' && (!enabled || profile.approved !== true || profile.active !== true || profile.is_player !== true)) {
    throw new CheckoutError('Player payments are unavailable.', 403, 'forbidden')
  }
  if (action !== 'quote' && !UUID.test(body.attempt_id ?? '')) throw new CheckoutError('A valid payment attempt reference is required.')
  if (action === 'start') validateCheckoutAmount(body.amount_pence)
  if (action !== 'status' && !['balance', 'top_up'].includes(body.kind)) throw new CheckoutError('Choose pay balance or add money.')
  if (action === 'quote' && body.kind === 'top_up') validateCheckoutAmount(body.amount_pence)
  const platform = await stripe('/account')
  if (!/^acct_[A-Za-z0-9]+$/.test(platform?.id ?? '')) throw new ConnectError('Stripe platform verification failed.')
  const scope = { club_id: profile.club_id, profile_id: profile.id, platform_account_id: platform.id, livemode: mode === 'live' }
  if (action === 'status') {
    const attempt = await store.readAttempt(scope, body.attempt_id)
    if (!attempt || attempt.profile_id !== profile.id || attempt.club_id !== profile.club_id ||
      attempt.platform_account_id !== scope.platform_account_id || attempt.livemode !== scope.livemode) {
      throw new CheckoutError('Payment attempt not found.', 404, 'not_found')
    }
    if (!attempt.checkout_session_id || ['succeeded', 'failed', 'expired'].includes(attempt.status)) return attemptResult(attempt)
    const session = await connectedStripe(attempt.stripe_account_id)(`/checkout/sessions/${encodeURIComponent(attempt.checkout_session_id)}`)
    assertCheckoutSession(session, attempt, attempt.stripe_customer_id)
    return attemptResult(attempt, session)
  }
  const connection = await store.connection(scope)
  if (!connection?.stripe_account_id) throw new CheckoutError('The club is not ready for online payments.', 409, 'not_ready')
  const providerAccount = await stripe(`/accounts/${encodeURIComponent(connection.stripe_account_id)}`)
  assertAccountScope(providerAccount, connection)
  if (providerAccount.charges_enabled !== true || providerAccount.payouts_enabled !== true) {
    throw new CheckoutError('The club is not ready for online payments.', 409, 'not_ready')
  }
  if (action === 'quote') return paymentQuote(await store.quote(scope), body.kind, body.amount_pence)
  const reserved = await store.reserve(scope, body, checkoutCallbacks(appBaseUrl, body.attempt_id))
  if (reserved.stale) throw new CheckoutError('Your balance changed. Check the new amount before confirming.', 409,
    'stale_quote', paymentQuote(reserved.quote, 'balance'))
  const { attempt, customer } = reserved
  if (!attempt || attempt.club_id !== scope.club_id || attempt.profile_id !== scope.profile_id ||
    attempt.platform_account_id !== scope.platform_account_id || attempt.livemode !== scope.livemode ||
    attempt.stripe_account_id !== connection.stripe_account_id || attempt.id !== body.attempt_id ||
    attempt.kind !== body.kind || attempt.amount_pence !== body.amount_pence ||
    customer.club_id !== scope.club_id || customer.profile_id !== scope.profile_id ||
    customer.platform_account_id !== scope.platform_account_id || customer.livemode !== scope.livemode ||
    customer.stripe_account_id !== attempt.stripe_account_id) {
    throw new ConnectError('Payment account verification failed.')
  }
  const direct = connectedStripe(attempt.stripe_account_id)
  const customerId = await ensureStripeCustomer(direct, customer, store.saveCustomer, now)
  const session = await ensureCheckoutSession(direct, attempt, customerId, now)
  let url
  if (session.status === 'open') {
    try { url = new URL(session.url) } catch { throw new ConnectError('Stripe returned an invalid Checkout link.') }
    if (url.origin !== 'https://checkout.stripe.com' || url.username || url.password) throw new ConnectError('Stripe returned an invalid Checkout link.')
  }
  await store.saveSession(attempt.id, customerId, session.id, url?.href ?? null)
  return { ...attemptResult(attempt, session), ...(url ? { checkout_url: url.href } : {}) }
}
