import { describe, expect, it, vi } from 'vitest'
import { londonDateBounds, payoutBalanceLine, runPayoutAction, stripePages } from './stripePayouts.js'

const profile = { id: 'manager', club_id: 'club', role: 'admin', active: true, approved: true }
const connection = { club_id: 'club', platform_account_id: 'acct_platform', livemode: false, stripe_account_id: 'acct_club' }
const payout = { id: 'po_one', object: 'payout', livemode: false, amount: 660, currency: 'gbp', created: 1796083200,
  arrival_date: 1796169600, automatic: true, status: 'paid', reconciliation_status: 'completed' }
const charge = { id: 'txn_charge', created: 1796083200, type: 'charge', reporting_category: 'charge', currency: 'gbp', amount: 900, fee: 30, net: 870,
  source: { id: 'ch_one', object: 'charge', livemode: false, payment_intent: 'pi_one', balance_transaction: 'txn_charge' } }
const refund = { id: 'txn_refund', created: 1796083201, type: 'refund', currency: 'gbp', amount: -200, fee: 0, net: -200,
  source: { id: 're_one', object: 'refund', livemode: false, payment_intent: 'pi_one', balance_transaction: 'txn_refund' } }
function harness(extra = {}) {
  const report = { mode: 'test', connected: true, payouts: [{ payout_id: 'po_one' }] }
  const store = { connection: vi.fn(async () => connection), save: vi.fn(async () => {}), report: vi.fn(async () => report) }
  const platformStripe = vi.fn(async () => ({ id: 'acct_platform' }))
  const stripe = vi.fn(async path => path.startsWith('/payouts/') ? payout : { data: [charge, refund], has_more: false })
  const connectedStripe = vi.fn(() => stripe)
  const run = overrides => runPayoutAction({ action: 'refresh', payoutId: 'po_one', from: '2026-12-01', to: '2026-12-31', profile,
    enabled: true, platformAccountId: 'acct_platform', mode: 'test', store, platformStripe, connectedStripe, ...extra, ...overrides })
  return { run, store, platformStripe, stripe, connectedStripe, report }
}

describe('Payout provider reconciliation', () => {
  it.each([{ ...profile, role: 'player', is_player: true }, { ...profile, approved: false }, { ...profile, active: false }])('refuses unauthorised manager %j before providers or storage', async caller => {
    const h = harness()
    await expect(h.run({ profile: caller })).rejects.toMatchObject({ status: 403 })
    expect(h.store.connection).not.toHaveBeenCalled(); expect(h.platformStripe).not.toHaveBeenCalled()
  })
  it('gates pause before calls', async () => {
    const h = harness()
    await expect(h.run({ enabled: false })).rejects.toMatchObject({ status: 403 })
    expect(h.store.report).not.toHaveBeenCalled()
  })
  it('reads cached report without provider calls or a provider key', async () => {
    const h = harness()
    expect(await h.run({ action: 'list', payoutId: null })).toEqual(h.report)
    expect(h.platformStripe).not.toHaveBeenCalled(); expect(h.connectedStripe).not.toHaveBeenCalled()
  })
  it('explicitly reports missing connection and never creates a new one', async () => {
    const h = harness(); h.store.connection.mockResolvedValue(null)
    await expect(h.run()).rejects.toMatchObject({ status: 409 })
    expect(h.platformStripe).not.toHaveBeenCalled(); expect(h.store.save).not.toHaveBeenCalled()
  })
  it('binds every provider read to the configured platform and connected account, with GET only', async () => {
    const h = harness()
    await h.run()
    expect(h.platformStripe).toHaveBeenCalledWith('/account', { method: 'GET' })
    expect(h.connectedStripe).toHaveBeenCalledWith('acct_club')
    for (const [, options] of h.stripe.mock.calls) expect(options).toEqual({ method: 'GET' })
    expect(h.stripe).toHaveBeenCalledWith('/balance_transactions?payout=po_one&expand%5B%5D=data.source&limit=100', { method: 'GET' })
    expect(h.store.save).toHaveBeenCalledWith(expect.objectContaining({ club_id: 'club', livemode: false }), 'manager', payout,
      expect.arrayContaining([expect.objectContaining({ payment_intent_id: 'pi_one', amount_pence: 900, fee_pence: 30 }), expect.objectContaining({ refund_id: 're_one', amount_pence: -200 })]), true, [])
  })
  it('paginates payout discovery and every component page without dropping rows', async () => {
    const h = harness()
    h.stripe.mockImplementation(async path => {
      const url = new URL(path, 'https://stripe.invalid')
      if (url.pathname === '/payouts') return url.searchParams.has('starting_after') ? { data: [{ ...payout, id: 'po_two' }], has_more: false } : { data: [payout], has_more: true }
      return url.searchParams.has('starting_after') ? { data: [refund], has_more: false } : { data: [charge], has_more: true }
    })
    await h.run({ payoutId: null })
    expect(h.store.save).toHaveBeenCalledTimes(2)
    for (const call of h.store.save.mock.calls) expect(call[3]).toHaveLength(2)
    expect(h.stripe.mock.calls.some(([path]) => path.includes('starting_after=po_one'))).toBe(true)
    expect(h.stripe.mock.calls.some(([path]) => path.includes('starting_after=txn_charge'))).toBe(true)
  })
  it.each([
    { data: [charge], has_more: true }, { data: [], has_more: true }, { data: [charge] },
  ])('rejects broken/cyclic pagination and never persists a partial finding %j', async page => {
    const h = harness(); h.stripe.mockImplementation(async path => path.startsWith('/payouts/') ? payout : page)
    await expect(h.run()).rejects.toThrow()
    expect(h.store.save).not.toHaveBeenCalled()
  })
  it('keeps previously persisted findings when provider retrieval fails mid-page', async () => {
    const h = harness()
    h.stripe.mockImplementation(async path => {
      if (path.startsWith('/payouts/')) return payout
      if (path.includes('starting_after')) throw new Error('provider down')
      return { data: [charge], has_more: true }
    })
    await expect(h.run()).rejects.toThrow('provider down')
    expect(h.store.save).not.toHaveBeenCalled()
  })
  it.each([{ ...payout, livemode: true }, { ...payout, id: 'po_foreign' }, { ...payout, amount: 1.5 }, { ...payout, amount: -1.5 }])('refuses mismatched payout %j before persistence', async wrong => {
    const h = harness(); h.stripe.mockResolvedValue(wrong)
    await expect(h.run()).rejects.toThrow('verification')
    expect(h.store.save).not.toHaveBeenCalled()
  })
  it.each(['paid', 'failed'])('preserves a signed negative %s payout amount through provider refresh', async status => {
    const h = harness()
    h.stripe.mockImplementation(async path => path.startsWith('/payouts/') ? { ...payout, amount: -200, status } : { data: [refund], has_more: false })
    await h.run()
    expect(h.store.save.mock.calls[0][2]).toMatchObject({ amount: -200, status })
    expect(h.store.save.mock.calls[0][3]).toEqual([expect.objectContaining({ amount_pence: -200, net_pence: -200 })])
  })
  it('excludes only the exact own payout settlement, preserving other payout and unknown movements', async () => {
    const h = harness()
    const own = { ...refund, id: 'txn_ownPayout', type: 'payout', source: 'po_one', amount: 200, net: 200 }
    const other = { ...own, id: 'txn_otherPayout', source: 'po_other' }
    const failure = { ...own, id: 'txn_failedPayout', type: 'payout_failure' }
    h.stripe.mockImplementation(async path => path.startsWith('/payouts/') ? { ...payout, amount: -200, balance_transaction: 'txn_ownPayout' }
      : { data: [refund, own, other, failure], has_more: false })
    await h.run()
    expect(h.store.save.mock.calls[0][3].map(row => row.balance_transaction_id)).toEqual(['txn_refund', 'txn_otherPayout', 'txn_failedPayout'])
  })
  it('uses exact own payout source only when its balance-transaction pointer is unavailable', async () => {
    const h = harness()
    h.stripe.mockImplementation(async path => path.startsWith('/payouts/') ? { ...payout, amount: -200, balance_transaction: null }
      : { data: [refund, { ...refund, id: 'txn_ownPayout', type: 'payout', source: { id: 'po_one', object: 'payout' }, amount: 200, net: 200 }], has_more: false })
    await h.run()
    expect(h.store.save.mock.calls[0][3].map(row => row.balance_transaction_id)).toEqual(['txn_refund'])
  })
  it('does not exclude a contradictory payout source despite matching transaction ID', async () => {
    const h = harness()
    h.stripe.mockImplementation(async path => path.startsWith('/payouts/') ? { ...payout, balance_transaction: 'txn_ownPayout' }
      : { data: [{ ...refund, id: 'txn_ownPayout', type: 'payout', source: 'po_other' }], has_more: false })
    await h.run()
    expect(h.store.save.mock.calls[0][3]).toHaveLength(1)
  })
  it('refuses a different configured platform before connected account reads', async () => {
    const h = harness(); h.platformStripe.mockResolvedValue({ id: 'acct_other' })
    await expect(h.run()).rejects.toThrow('platform')
    expect(h.connectedStripe).not.toHaveBeenCalled()
  })
  it('stores unknown/foreign movements visibly without inventing player identities', async () => {
    const h = harness(); h.stripe.mockImplementation(async path => path.startsWith('/payouts/') ? payout : {
      data: [{ ...charge, id: 'txn_unknown', type: 'adjustment', currency: 'eur', source: 'tr_unknown' }], has_more: false,
    })
    await h.run()
    expect(h.store.save.mock.calls[0][3][0]).toMatchObject({ type: 'adjustment', currency: 'eur', source_id: 'tr_unknown', payment_intent_id: null, refund_id: null })
  })
  it('retains explicit incomplete/manual payout findings without attempting unsupported component filtering', async () => {
    const h = harness(); h.stripe.mockResolvedValue({ ...payout, automatic: false, reconciliation_status: 'not_applicable' })
    await h.run()
    expect(h.stripe).toHaveBeenCalledTimes(1)
    expect(h.store.save.mock.calls[0].slice(3, 5)).toEqual([[], false])
    expect(h.store.save.mock.calls[0][5]).toEqual(['Manual payout components cannot be identified automatically'])
  })
  it('does not claim provider reconciliation is complete before Stripe finishes', async () => {
    const h = harness(); h.stripe.mockImplementation(async path => path.startsWith('/payouts/') ? { ...payout, reconciliation_status: 'in_progress' } : { data: [charge], has_more: false })
    await h.run(); expect(h.store.save.mock.calls[0][4]).toBe(false)
  })
  it('resolves an unexpanded charge/refund with connected GET and preserves source mismatches as unresolved', async () => {
    const stripe = vi.fn(async () => ({ ...charge.source, balance_transaction: 'txn_wrong' }))
    expect(await payoutBalanceLine({ ...charge, source: 'ch_one' }, stripe, 'test')).toMatchObject({ payment_intent_id: 'pi_one', issue: 'Provider source balance transaction differs' })
    expect(stripe).toHaveBeenCalledWith('/charges/ch_one', { method: 'GET' })
    stripe.mockResolvedValue(refund.source)
    expect(await payoutBalanceLine({ ...refund, source: 're_one' }, stripe, 'test')).toMatchObject({ refund_id: 're_one', payment_intent_id: 'pi_one' })
    expect(stripe).toHaveBeenCalledWith('/refunds/re_one', { method: 'GET' })
  })
  it.each(['refund_failure', 'payment_refund'])('verifies positive %s from exact Refund.failure_balance_transaction', async type => {
    const restored = { ...refund, id: 'txn_restored', type, reporting_category: 'refund_failure', amount: 100, fee: 0, net: 100,
      source: { ...refund.source, amount: 100, status: 'failed', failure_balance_transaction: 'txn_restored' } }
    // The Refund retains its original debit balance_transaction. It is the
    // separate failure_balance_transaction that verifies this positive row.
    expect(await payoutBalanceLine(restored, vi.fn(), 'test')).toMatchObject({ refund_id: 're_one', payment_intent_id: 'pi_one',
      failure_balance_transaction_id: 'txn_restored', amount_pence: 100, net_pence: 100, issue: null })
  })
  it.each([
    { status: 'failed' }, { status: 'failed', failure_balance_transaction: 'txn_wrong' },
    { status: 'succeeded', failure_balance_transaction: 'txn_restored' },
  ])('leaves an unverified positive refund source unresolved %j', async evidence => {
    expect(await payoutBalanceLine({ ...refund, id: 'txn_restored', type: 'refund_failure', amount: 100, net: 100,
      source: { ...refund.source, ...evidence } }, vi.fn(), 'test')).toMatchObject({ issue: 'Provider refund failure balance transaction not verified' })
  })
  it('resolves the real unexpanded positive refund shape via connected GET without requiring Refund.livemode', async () => {
    const { livemode: _unused, ...actualRefund } = refund.source
    const stripe = vi.fn(async () => ({ ...actualRefund, amount: 100, status: 'failed', failure_balance_transaction: 'txn_restored' }))
    expect(await payoutBalanceLine({ ...refund, id: 'txn_restored', type: 'refund_failure', reporting_category: 'refund_failure',
      amount: 100, net: 100, source: 're_one' }, stripe, 'test')).toMatchObject({ failure_balance_transaction_id: 'txn_restored', refund_id: 're_one', issue: null })
    expect(stripe).toHaveBeenCalledWith('/refunds/re_one', { method: 'GET' })
  })
  it('never guesses a refund from description text on an unknown movement', async () => {
    expect(await payoutBalanceLine({ ...refund, id: 'txn_adjustment', type: 'adjustment', source: null,
      amount: 100, net: 100, description: 'Refund re_one failed and returned' }, vi.fn(), 'test'))
      .toMatchObject({ source_id: null, refund_id: null, payment_intent_id: null, failure_balance_transaction_id: null })
  })
  it('rejects a source returned from another mode or identity', async () => {
    await expect(payoutBalanceLine({ ...charge, source: { ...charge.source, livemode: true } }, vi.fn(), 'test')).rejects.toThrow('mode')
    await expect(payoutBalanceLine({ ...charge, source: 'ch_one' }, async () => ({ ...charge.source, id: 'ch_other' }), 'test')).rejects.toThrow('source')
  })
})

describe('Inclusive London payout dates', () => {
  it('handles 23-hour BST-start and 25-hour BST-end days', () => {
    const spring = londonDateBounds('2026-03-29', '2026-03-29'), autumn = londonDateBounds('2026-10-25', '2026-10-25')
    expect(spring.lt - spring.gte).toBe(23 * 3600)
    expect(autumn.lt - autumn.gte).toBe(25 * 3600)
    expect(new Date(autumn.gte * 1000).toISOString()).toBe('2026-10-24T23:00:00.000Z')
  })
  it.each([['2026-02-30', '2026-03-01'], ['2026-12-02', '2026-12-01'], [null, '2026-12-01']])('refuses invalid range %s / %s', (from, to) => {
    expect(() => londonDateBounds(from, to)).toThrow('valid')
  })
  it('pagination helper returns a genuinely empty complete page', async () => {
    expect(await stripePages(async () => ({ data: [], has_more: false }), '/payouts')).toEqual([])
  })
})
