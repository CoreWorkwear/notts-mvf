// Provider operations are injected for hermetic tests; no credentials reach callers.
export class ConnectError extends Error {
  constructor(message, status = 503) { super(message); this.status = status }
}

export function stripeMode(secret) {
  const mode = /^(?:sk|rk)_(test|live)_/.exec(secret ?? '')?.[1]
  if (!mode) throw new ConnectError('Stripe payments are not configured.')
  return mode
}

export function createStripeClient(secret, fetcher = fetch) {
  stripeMode(secret)
  return async (path, { method = 'GET', body, idempotencyKey } = {}) => {
    const v2 = path.startsWith('/v2/')
    const headers = { Authorization: `Bearer ${secret}`, 'Stripe-Version': '2026-11-18.endive' }
    if (body) headers['Content-Type'] = v2 ? 'application/json' : 'application/x-www-form-urlencoded'
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
    let response
    try {
      response = await fetcher(`https://api.stripe.com${v2 ? '' : '/v1'}${path}`, {
        method, headers, body: body ? (v2 ? JSON.stringify(body) : new URLSearchParams(body)) : undefined,
        signal: AbortSignal.timeout(15000),
      })
    } catch { throw new ConnectError('Stripe is temporarily unavailable. Please try again.') }
    if (!response.ok) throw new ConnectError('Stripe could not complete the request. Please try again.')
    try { return await response.json() } catch { throw new ConnectError('Stripe returned an invalid response.') }
  }
}

export function authorizeConnection(profile, action, enabled) {
  if (!profile?.club_id || profile.active !== true || profile.approved !== true ||
    (profile.role !== 'admin' && profile.is_player !== true) || (action === 'onboard' && profile.role !== 'admin')) {
    throw new ConnectError('Club payments access refused.', 403)
  }
  if (!enabled) throw new ConnectError('Club payments are unavailable.', 403)
}

export function onboardingCallbacks(base, mode = 'test') {
  let origin
  try { origin = new URL(base) } catch { throw new ConnectError('Payment setup is not configured.') }
  if (origin.username || origin.password || (origin.protocol !== 'https:' &&
    !(mode === 'test' && origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) {
    throw new ConnectError('Payment setup is not configured.')
  }
  const url = new URL('/manage/settings/stripe', origin)
  url.searchParams.set('stripe', 'refresh')
  const refresh_url = url.href
  url.searchParams.set('stripe', 'return')
  return { refresh_url, return_url: url.href }
}

function metadataFor(row) {
  return { club_id: row.club_id, platform_account_id: row.platform_account_id,
    provider_mode: row.livemode ? 'live' : 'test', connection_creation_id: row.creation_id }
}

export function assertAccountScope(account, row) {
  const expected = metadataFor(row)
  if (!/^acct_[A-Za-z0-9]+$/.test(account?.id ?? '') || account.id === row.platform_account_id ||
    (row.stripe_account_id && row.stripe_account_id !== account.id) ||
    Object.entries(expected).some(([key, value]) => account.metadata?.[key] !== value) ||
    (typeof account.livemode === 'boolean' && account.livemode !== row.livemode)) {
    throw new ConnectError('Stripe account verification failed.')
  }
}

// Stripe can prune idempotency keys after 24 hours. An old uncertain reservation
// is read-only reconciled; it must NEVER create a replacement account automatically.
export async function loadOrCreateAccount(stripe, row, now = Date.now()) {
  if (row.stripe_account_id) {
    const account = await stripe(`/accounts/${encodeURIComponent(row.stripe_account_id)}`)
    assertAccountScope(account, row)
    return account
  }
  const age = now - Date.parse(row.creation_started_at)
  if (!Number.isFinite(age) || age < 0) throw new ConnectError('Stripe setup needs support to recover its account.')
  if (age >= 23 * 60 * 60 * 1000) {
    let after
    let found
    do {
      const query = new URLSearchParams({ limit: '100', ...(after ? { starting_after: after } : {}) })
      const page = await stripe(`/accounts?${query}`)
      if (!Array.isArray(page.data)) throw new ConnectError('Stripe returned an invalid response.')
      for (const account of page.data) {
        if (account.metadata?.connection_creation_id !== row.creation_id) continue
        assertAccountScope(account, row)
        if (found) throw new ConnectError('Stripe setup needs support to recover its account.')
        found = account
      }
      after = page.has_more ? page.data.at(-1)?.id : null
      if (page.has_more && !after) throw new ConnectError('Stripe returned an invalid response.')
    } while (after)
    if (!found) throw new ConnectError('Stripe setup needs support to recover its account.')
    return found
  }
  // New Connect platforms must create Accounts v2. A Merchant configuration is
  // the direct-charge merchant of record and includes its own payout capability;
  // Recipient/stripe_transfers belongs to a different funds flow.
  const body = {
    identity: { country: 'gb' }, dashboard: 'full',
    configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
    defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
    metadata: metadataFor(row),
  }
  const created = await stripe('/v2/core/accounts', { method: 'POST', body, idempotencyKey: `club-connect:v2:${row.creation_id}` })
  assertAccountScope(created, row)
  // Stripe explicitly supports v1 reads of v2 Accounts, translated to the v1
  // shape. Keep requirements and charges_enabled/payouts_enabled provider-owned.
  const account = await stripe(`/accounts/${encodeURIComponent(created.id)}`)
  assertAccountScope(account, { ...row, stripe_account_id: created.id })
  return account
}

export function accountStatus(account, mode, manager, checkedAt = new Date().toISOString()) {
  const ready = account?.charges_enabled === true && account?.payouts_enabled === true
  const result = { connected: !!account, ready, mode }
  if (!manager) return result
  const requirements = account?.requirements ?? {}
  return {
    ...result, charges_enabled: account?.charges_enabled === true, payouts_enabled: account?.payouts_enabled === true,
    requirements: Object.fromEntries(['currently_due', 'past_due', 'eventually_due', 'pending_verification']
      .map(key => [key, Array.isArray(requirements[key]) ? requirements[key].filter(v => typeof v === 'string') : []])
      .concat([['disabled_reason', typeof requirements.disabled_reason === 'string' ? requirements.disabled_reason : null]])),
    capabilities: { card_payments: account?.capabilities?.card_payments ?? 'inactive',
      pay_by_bank_payments: account?.capabilities?.pay_by_bank_payments ?? 'inactive' },
    checked_at: account ? checkedAt : null,
  }
}

export async function runConnectAction({ action, profile, enabled, mode, platformAccountId, stripe, store, appBaseUrl, now }) {
  if (!['status', 'onboard'].includes(action)) throw new ConnectError('Choose a valid payment setup action.', 400)
  const manager = profile?.role === 'admin'
  // Stripe account preparation is available before the club turns on payments.
  // The shared authorizer still enforces the flag at the payout boundary.
  authorizeConnection(profile, action, manager || enabled)
  // Validate callbacks before a provider account can be created.
  const callbacks = action === 'onboard' ? onboardingCallbacks(appBaseUrl, mode) : null
  if (mode === 'live' && !/^acct_[A-Za-z0-9]+$/.test(platformAccountId ?? '')) {
    throw new ConnectError('The live Stripe platform is not configured.')
  }
  const platform = await stripe('/account')
  if (!/^acct_[A-Za-z0-9]+$/.test(platform?.id ?? '') || (platformAccountId && platform.id !== platformAccountId)) {
    throw new ConnectError('Stripe platform verification failed.')
  }
  const scope = { club_id: profile.club_id, platform_account_id: platform.id, livemode: mode === 'live' }
  const row = action === 'onboard' ? await store.reserve(scope, profile.id) : await store.read(scope)
  if (!row || (!row.stripe_account_id && action === 'status')) return accountStatus(null, mode, manager)
  const account = await loadOrCreateAccount(stripe, row, now)
  const status = accountStatus(account, mode, true)
  await store.save(row, account.id, status)
  if (!manager) return accountStatus(account, mode, false)
  if (action === 'onboard') {
    const link = await stripe('/v2/core/account_links', { method: 'POST', body: {
      account: account.id, use_case: { type: 'account_onboarding', account_onboarding: callbacks },
    } })
    let url
    try { url = new URL(link.url) } catch { throw new ConnectError('Stripe returned an invalid onboarding link.') }
    if (!['https://connect.stripe.com', 'https://accounts.stripe.com'].includes(url.origin) || url.username || url.password) {
      throw new ConnectError('Stripe returned an invalid onboarding link.')
    }
    return { ...status, onboarding_url: url.href }
  }
  return status
}
