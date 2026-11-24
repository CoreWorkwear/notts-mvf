import { describe, it, expect, vi } from 'vitest'
import { runSavedCardsAction, savedCardToken, verifySavedCardToken } from './stripeSavedCards.js'

const secret = 'sk_test_mock_only'
const profile = { id: 'player-a', club_id: 'club-a', active: true, approved: true, is_player: true }
const connection = { club_id: 'club-a', platform_account_id: 'acct_platform', livemode: false,
  creation_id: 'connection', stripe_account_id: 'acct_club' }
const row = { ...connection, profile_id: profile.id, creation_id: 'customer-reservation', stripe_customer_id: 'cus_player' }
const customer = { id: 'cus_player', livemode: false, metadata: { club_id: 'club-a', profile_id: 'player-a',
  platform_account_id: 'acct_platform', provider_mode: 'test', customer_creation_id: 'customer-reservation' } }
const card = { id: 'pm_saved', type: 'card', customer: 'cus_player', livemode: false, allow_redisplay: 'always',
  card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030, fingerprint: 'private' },
  billing_details: { name: 'Private name', email: 'private@example.com' } }

function harness() {
  const stripe = vi.fn(async path => path === '/account' ? { id: 'acct_platform' } : {
    id: 'acct_club', metadata: { club_id: 'club-a', platform_account_id: 'acct_platform', provider_mode: 'test', connection_creation_id: 'connection' },
  })
  const direct = vi.fn(async path => path.startsWith('/customers/') ? customer
    : path.endsWith('/detach') ? { ...card, customer: null }
      : path.startsWith('/payment_methods?') ? { data: [card], has_more: false } : card)
  const connectedStripe = vi.fn(() => direct)
  const store = { connection: vi.fn(async () => connection), customer: vi.fn(async () => row) }
  const run = (body = { action: 'list' }, extra = {}) => runSavedCardsAction({
    body, profile, enabled: true, mode: 'test', stripe, connectedStripe, store, secret, ...extra,
  })
  return { stripe, direct, connectedStripe, store, run }
}

describe('saved card own-customer controls', () => {
  it('returns only opaque reference, brand and last four without private provider fields', async () => {
    const h = harness()
    const result = await h.run()
    expect(result.cards).toHaveLength(1)
    expect(Object.keys(result.cards[0]).sort()).toEqual(['brand', 'id', 'last4'])
    expect(result.cards[0]).toMatchObject({ brand: 'visa', last4: '4242' })
    expect(result.cards[0].id).toMatch(/^v1\.pm_saved\.[A-Za-z0-9_-]{43}$/)
    expect(JSON.stringify(result)).not.toMatch(/cus_player|acct_club|private|fingerprint|exp_year|email/)
    expect(h.connectedStripe).toHaveBeenCalledWith('acct_club')
    expect(h.direct).toHaveBeenCalledWith('/payment_methods?customer=cus_player&type=card&allow_redisplay=always&limit=100')
    expect(h.direct.mock.calls.every(call => call.length === 1)).toBe(true)
  })
  it.each([{ ...profile, active: false }, { ...profile, approved: false }, { ...profile, is_player: false }])('blocks unapproved/inactive/nonplayer access', async caller => {
      const h = harness()
      await expect(h.run(undefined, { profile: caller })).rejects.toMatchObject({ status: 403 })
      expect(h.stripe).not.toHaveBeenCalled()
    })
  it('requires the feature flag before provider access', async () => {
    const h = harness()
    await expect(h.run(undefined, { enabled: false })).rejects.toMatchObject({ status: 403 })
    expect(h.stripe).not.toHaveBeenCalled()
  })
  it('does not create a customer when no existing scoped customer exists', async () => {
    const h = harness()
    h.store.customer.mockResolvedValue(null)
    expect(await h.run()).toEqual({ cards: [] })
    expect(h.direct).not.toHaveBeenCalled()
  })
  it.each(['club_id', 'profile_id', 'platform_account_id', 'stripe_account_id', 'livemode'])('rejects mismatched database customer scope: %s', async key => {
      const h = harness()
      h.store.customer.mockResolvedValue({ ...row, [key]: key === 'livemode' ? true : 'other' })
      await expect(h.run()).rejects.toThrow('account verification failed')
      expect(h.direct).not.toHaveBeenCalled()
    })
  it('verifies provider customer metadata before fetching payment methods', async () => {
    const h = harness()
    h.direct.mockResolvedValue({ ...customer, metadata: { ...customer.metadata, profile_id: 'other' } })
    await expect(h.run()).rejects.toThrow('customer verification failed')
    expect(h.direct.mock.calls).toEqual([['/customers/cus_player']])
  })
  it('rejects a card belonging to another player or mode', async () => {
    for (const changed of [{ customer: 'cus_other' }, { livemode: true }, { type: 'bacs_debit' }]) {
      const h = harness()
      const base = h.direct.getMockImplementation()
      h.direct.mockImplementation(path => path.startsWith('/payment_methods?')
        ? { data: [{ ...card, ...changed }], has_more: false } : base(path))
      await expect(h.run()).rejects.toMatchObject({ status: 403 })
    }
  })
})

describe('confirmed removal and harmless retry', () => {
  it('requires explicit confirmation before any provider activity', async () => {
    const h = harness()
    await expect(h.run({ action: 'remove', id: 'pm_saved' })).rejects.toThrow('Confirm removal')
    expect(h.stripe).not.toHaveBeenCalled()
  })
  it('verifies scoped list-time ownership and current ownership before detaching', async () => {
    const h = harness()
    const token = (await h.run()).cards[0].id
    h.direct.mockClear()
    expect(await h.run({ action: 'remove', id: token, confirmed: true })).toEqual({ removed: true })
    expect(h.direct).toHaveBeenCalledWith('/payment_methods/pm_saved')
    expect(h.direct).toHaveBeenCalledWith('/payment_methods/pm_saved/detach', {
      method: 'POST', idempotencyKey: 'remove-card:customer-reservation:pm_saved',
    })
  })
  it('returns harmless success for a valid scoped token after the card was already detached', async () => {
    const h = harness()
    const token = (await h.run()).cards[0].id
    const base = h.direct.getMockImplementation()
    h.direct.mockImplementation(path => path === '/payment_methods/pm_saved' ? { ...card, customer: null } : base(path))
    h.direct.mockClear()
    expect(await h.run({ action: 'remove', id: token, confirmed: true })).toEqual({ removed: true })
    expect(h.direct.mock.calls.every(call => call.length === 1)).toBe(true)
  })
  it('never detaches another customer card even with a previously valid token', async () => {
    const h = harness()
    const token = await savedCardToken(row, 'pm_saved', secret)
    const base = h.direct.getMockImplementation()
    h.direct.mockImplementation(path => path === '/payment_methods/pm_saved' ? { ...card, customer: 'cus_other' } : base(path))
    await expect(h.run({ action: 'remove', id: token, confirmed: true })).rejects.toMatchObject({ status: 403 })
    expect(h.direct.mock.calls.every(call => call.length === 1)).toBe(true)
  })
  it('rejects tampering, raw ids and tokens copied across player/club/account/platform/mode/customer', async () => {
    const token = await savedCardToken(row, 'pm_saved', secret)
    for (const key of ['profile_id', 'club_id', 'stripe_account_id', 'platform_account_id', 'livemode', 'stripe_customer_id']) {
      await expect(verifySavedCardToken({ ...row, [key]: key === 'livemode' ? true : 'other' }, token, secret))
        .rejects.toMatchObject({ status: 403 })
    }
    for (const value of ['pm_saved', token.replace('pm_saved', 'pm_other'), token.replace('v1', 'v2'), `${token}x`]) {
      await expect(verifySavedCardToken(row, value, secret)).rejects.toMatchObject({ status: 403 })
    }
  })
  it('paginates all own cards and refuses a malformed provider continuation', async () => {
    const h = harness()
    const base = h.direct.getMockImplementation()
    h.direct.mockImplementation(path => path.startsWith('/payment_methods?')
      ? path.includes('starting_after') ? { data: [{ ...card, id: 'pm_second' }], has_more: false }
        : { data: [card], has_more: true } : base(path))
    expect((await h.run()).cards).toHaveLength(2)
    expect(h.direct.mock.calls.at(-1)[0]).toContain('starting_after=pm_saved')
  })
})
