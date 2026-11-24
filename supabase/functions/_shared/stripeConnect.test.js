import { describe, it, expect, vi } from 'vitest'
import { accountStatus, assertAccountScope, authorizeConnection, createStripeClient,
  loadOrCreateAccount, onboardingCallbacks, runConnectAction, stripeMode } from './stripeConnect.js'

const now = Date.parse('2026-11-24T15:00:00Z')
const profile = { id: 'manager', club_id: 'club-a', role: 'admin', approved: true, active: true }
const reservation = { club_id: 'club-a', platform_account_id: 'acct_platform', livemode: false,
  creation_id: 'fixed-reservation', creation_started_at: new Date(now).toISOString(), stripe_account_id: null }
function account(row = reservation, overrides = {}) {
  return { id: 'acct_club', charges_enabled: false, payouts_enabled: false,
    metadata: { club_id: row.club_id, platform_account_id: row.platform_account_id,
      provider_mode: row.livemode ? 'live' : 'test', connection_creation_id: row.creation_id },
    requirements: { currently_due: ['external_account'] }, capabilities: {}, ...overrides }
}
function harness(row = reservation) {
  let providerAccount = account(row)
  const store = {
    read: vi.fn(async () => ({ ...row })), reserve: vi.fn(async () => ({ ...row })), save: vi.fn(async () => {}),
  }
  const stripe = vi.fn(async path => {
    if (path === '/account') return { id: row.platform_account_id }
    if (path === '/v2/core/account_links') return { url: 'https://accounts.stripe.com/setup/single-use' }
    return providerAccount
  })
  const run = (extras = {}) => runConnectAction({ action: 'onboard', profile, enabled: true,
    mode: 'test', stripe, store, appBaseUrl: 'https://club.example', now, ...extras })
  return { stripe, store, run, setAccount: value => { providerAccount = value } }
}

describe('Stripe club connection boundaries', () => {
  it.each([
    [{ ...profile, role: 'player', is_player: true }, 'onboard', true],
    [{ ...profile, active: false }, 'status', true],
    [{ ...profile, approved: false }, 'status', true],
    [{ ...profile, club_id: null }, 'onboard', true],
    [{ ...profile, role: 'player', is_player: false }, 'status', true],
    [profile, 'onboard', false],
  ])('refuses unauthorized or paused calls before Stripe/store activity', async (caller, action, enabled) => {
    const h = harness()
    await expect(h.run({ profile: caller, action, enabled })).rejects.toMatchObject({ status: 403 })
    expect(h.stripe).not.toHaveBeenCalled()
    expect(h.store.reserve).not.toHaveBeenCalled()
  })

  it('allows approved active players status only', () => {
    expect(() => authorizeConnection({ ...profile, role: 'player', is_player: true }, 'status', true)).not.toThrow()
  })

  it('separates provider modes and rejects unknown keys', () => {
    expect(stripeMode('sk_test_fake')).toBe('test')
    expect(stripeMode('sk_live_fake')).toBe('live')
    expect(stripeMode('rk_test_fake')).toBe('test')
    expect(stripeMode('rk_live_fake')).toBe('live')
    expect(() => stripeMode('pk_test_fake')).toThrow('not configured')
    const a = account()
    for (const row of [{ ...reservation, club_id: 'club-b' }, { ...reservation, livemode: true },
      { ...reservation, platform_account_id: 'acct_other' }, { ...reservation, stripe_account_id: 'acct_other' }]) {
      expect(() => assertAccountScope(a, row)).toThrow('verification failed')
    }
    expect(() => assertAccountScope(account(reservation, { livemode: true }), reservation)).toThrow()
  })

  it('does not expose manager fields, identifiers or requirements to players', async () => {
    const row = { ...reservation, stripe_account_id: 'acct_club' }
    const h = harness(row)
    h.setAccount(account(row, { charges_enabled: true, payouts_enabled: true }))
    const result = await h.run({ action: 'status', profile: { ...profile, role: 'player', is_player: true } })
    expect(result).toEqual({ connected: true, ready: true, mode: 'test' })
    expect(h.stripe).toHaveBeenCalledWith('/accounts/acct_club')
    expect(h.stripe).not.toHaveBeenCalledWith('/v2/core/account_links', expect.anything())
  })
})

describe('durable connected account creation and fresh readiness', () => {
  it('uses identical creation parameters/idempotency for concurrent calls and resumed setup', async () => {
    const h = harness()
    await Promise.all([h.run(), h.run()])
    const creates = h.stripe.mock.calls.filter(([path]) => path === '/v2/core/accounts')
    expect(creates).toHaveLength(2)
    expect(creates[0]).toEqual(creates[1])
    expect(creates[0][1]).toEqual({ method: 'POST', idempotencyKey: 'club-connect:v2:fixed-reservation', body: {
      identity: { country: 'gb' }, dashboard: 'full',
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
      defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
      metadata: { club_id: 'club-a', platform_account_id: 'acct_platform',
        provider_mode: 'test', connection_creation_id: 'fixed-reservation' },
    } })
    expect(h.store.save).toHaveBeenCalledWith(reservation, 'acct_club', expect.anything())
  })

  it('retries the same provider reservation when persistence fails after creation', async () => {
    const h = harness()
    h.store.save.mockRejectedValueOnce(new Error('db unavailable'))
    await expect(h.run()).rejects.toThrow('db unavailable')
    await h.run()
    const creates = h.stripe.mock.calls.filter(([path]) => path === '/v2/core/accounts')
    expect(creates[0]).toEqual(creates[1])
    expect(h.stripe.mock.calls.filter(([path]) => path === '/v2/core/account_links')).toHaveLength(1)
  })

  it('never creates again after the provider idempotency window; reconciles metadata read-only', async () => {
    const row = { ...reservation, creation_started_at: new Date(now - 24 * 3600000).toISOString() }
    const stripe = vi.fn(async () => ({ data: [account(row)], has_more: false }))
    expect((await loadOrCreateAccount(stripe, row, now)).id).toBe('acct_club')
    expect(stripe.mock.calls).toEqual([['/accounts?limit=100']])
    stripe.mockResolvedValue({ data: [], has_more: false })
    await expect(loadOrCreateAccount(stripe, row, now)).rejects.toThrow('needs support')
    expect(stripe.mock.calls.every(call => call.length === 1)).toBe(true)
  })

  it('rejects ambiguous duplicates and metadata belonging to another club', async () => {
    const row = { ...reservation, creation_started_at: new Date(now - 24 * 3600000).toISOString() }
    await expect(loadOrCreateAccount(async () => ({ data: [account(row), account(row)], has_more: false }), row, now))
      .rejects.toThrow('needs support')
    await expect(loadOrCreateAccount(async () => account({ ...row, club_id: 'club-b' }), reservation, now))
      .rejects.toThrow('verification failed')
  })

  it('reads the same account freshly and disables readiness if provider requirements change', async () => {
    const row = { ...reservation, stripe_account_id: 'acct_club' }
    const h = harness(row)
    h.setAccount(account(row, { charges_enabled: true, payouts_enabled: true }))
    expect((await h.run({ action: 'status' })).ready).toBe(true)
    h.setAccount(account(row, { charges_enabled: true, payouts_enabled: false,
      requirements: { currently_due: ['external_account'], disabled_reason: 'requirements.past_due' } }))
    const changed = await h.run({ action: 'status' })
    expect(changed.ready).toBe(false)
    expect(changed.requirements.currently_due).toEqual(['external_account'])
    expect(changed.requirements.disabled_reason).toBe('requirements.past_due')
    expect(h.stripe.mock.calls.filter(([path]) => path === '/accounts/acct_club')).toHaveLength(2)
    expect(h.store.reserve).not.toHaveBeenCalled()
  })

  it('does not assume a return or single-use link means ready', async () => {
    const h = harness()
    const result = await h.run()
    expect(result.ready).toBe(false)
    expect(result.onboarding_url).toBe('https://accounts.stripe.com/setup/single-use')
    expect(h.stripe).toHaveBeenCalledWith('/v2/core/account_links', { method: 'POST', body: {
      account: 'acct_club', use_case: { type: 'account_onboarding', account_onboarding: {
        refresh_url: 'https://club.example/manage/settings/stripe?stripe=refresh',
        return_url: 'https://club.example/manage/settings/stripe?stripe=return',
      } },
    } })
  })

  it('uses translated fresh v1 status after v2 creation rather than guessing from create response', async () => {
    const h = harness()
    const provider = h.stripe.getMockImplementation()
    h.stripe.mockImplementation(async (path, options) => path === '/v2/core/accounts'
      ? { ...account(), object: 'v2.core.account', charges_enabled: undefined, payouts_enabled: undefined }
      : path === '/accounts/acct_club' ? account(reservation, { charges_enabled: true, payouts_enabled: true })
        : provider(path, options))
    expect((await h.run()).ready).toBe(true)
    expect(h.stripe).toHaveBeenCalledWith('/accounts/acct_club')
    expect(h.stripe.mock.calls.findIndex(([path]) => path === '/accounts/acct_club'))
      .toBeLessThan(h.stripe.mock.calls.findIndex(([path]) => path === '/v2/core/account_links'))
  })

  it('has no provider creation side effects on status without an account', async () => {
    const h = harness()
    expect(await h.run({ action: 'status' })).toMatchObject({ connected: false, ready: false })
    expect(h.stripe.mock.calls).toEqual([['/account']])
    expect(h.store.reserve).not.toHaveBeenCalled()
    expect(h.store.save).not.toHaveBeenCalled()
  })

  it('validates callbacks before creating anything', async () => {
    const h = harness()
    await expect(h.run({ appBaseUrl: 'http://external.example' })).rejects.toThrow('not configured')
    expect(h.stripe).not.toHaveBeenCalled()
    expect(onboardingCallbacks('http://localhost:5173').return_url).toContain('http://localhost:5173/')
    expect(() => onboardingCallbacks('https://user:pass@club.example')).toThrow()
  })

  it.each(['https://user:pass@connect.stripe.com/setup', 'https://connect.stripe.com:444/setup',
    'https://user:pass@accounts.stripe.com/setup', 'https://accounts.stripe.com:444/setup',
    'http://connect.stripe.com/setup', 'https://other.example/setup'])('refuses unsafe onboarding links: %s', async url => {
    const h = harness()
    const provider = h.stripe.getMockImplementation()
    h.stripe.mockImplementation(async (path, options) => path === '/v2/core/account_links' ? { url } : provider(path, options))
    await expect(h.run()).rejects.toThrow('invalid onboarding link')
  })

  it('requires both provider charges and payouts for readiness', () => {
    expect(accountStatus(account(reservation, { charges_enabled: true }), 'test', false).ready).toBe(false)
    expect(accountStatus(account(reservation, { payouts_enabled: true }), 'test', false).ready).toBe(false)
  })
})

describe('Stripe transport', () => {
  it('sends v2 requests as JSON to the v2 endpoint with the durable idempotency identity', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'acct_club' }) }))
    const stripe = createStripeClient('sk_test_placeholder', fetcher)
    const body = { identity: { country: 'gb' }, dashboard: 'full' }
    await stripe('/v2/core/accounts', { method: 'POST', body, idempotencyKey: 'club-connect:v2:stable' })
    expect(fetcher).toHaveBeenCalledWith('https://api.stripe.com/v2/core/accounts', expect.objectContaining({
      method: 'POST', body: JSON.stringify(body),
      headers: { Authorization: 'Bearer sk_test_placeholder', 'Stripe-Version': '2026-11-18.endive',
        'Content-Type': 'application/json', 'Idempotency-Key': 'club-connect:v2:stable' },
    }))
  })

  it('pins supported API, sends secrets only to Stripe and URL encodes bodies', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'acct_club' }) }))
    const stripe = createStripeClient('sk_test_placeholder', fetcher)
    await stripe('/accounts', { method: 'POST', body: { country: 'GB' }, idempotencyKey: 'stable' })
    expect(fetcher).toHaveBeenCalledWith('https://api.stripe.com/v1/accounts', expect.objectContaining({
      method: 'POST', headers: { Authorization: 'Bearer sk_test_placeholder', 'Stripe-Version': '2026-11-18.endive',
        'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': 'stable' },
    }))
    expect(fetcher.mock.calls[0][1].body.toString()).toBe('country=GB')
  })

  it('redacts provider errors and network failures', async () => {
    await expect(createStripeClient('sk_test_placeholder', async () => ({ ok: false }))('/account'))
      .rejects.toThrow('could not complete')
    await expect(createStripeClient('sk_test_placeholder', async () => { throw new Error('secret in transport') })('/account'))
      .rejects.toThrow('temporarily unavailable')
  })
})
