import { ConnectError, authorizeConnection } from './stripeConnect.js'

export class PayoutError extends ConnectError {}
const idOf = value => typeof value === 'string' ? value : value?.id
const integer = value => Number.isSafeInteger(value)
const currencies = value => typeof value === 'string' && /^[a-z]{3}$/.test(value)

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
export function londonDateBounds(from, to) {
  if (!validDate(from) || !validDate(to) || from > to) throw new PayoutError('Choose a valid inclusive payout period.', 400)
  const midnight = date => {
    const utc = Date.parse(`${date}T00:00:00Z`)
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(utc)).map(part => [part.type, part.value]))
    const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
    return (utc - (local - utc)) / 1000
  }
  const next = new Date(Date.parse(`${to}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
  return { gte: midnight(from), lt: midnight(next) }
}

export async function stripePages(stripe, path, query = {}) {
  const rows = [], seen = new Set()
  let after
  for (let pageNumber = 0; pageNumber < 1000; pageNumber++) {
    const params = new URLSearchParams({ ...query, limit: '100', ...(after ? { starting_after: after } : {}) })
    const page = await stripe(`${path}?${params}`, { method: 'GET' })
    if (!Array.isArray(page?.data) || typeof page.has_more !== 'boolean') throw new PayoutError('Stripe returned an incomplete page.')
    for (const row of page.data) {
      if (typeof row?.id !== 'string' || seen.has(row.id)) throw new PayoutError('Stripe pagination could not be verified.')
      seen.add(row.id); rows.push(row)
    }
    if (!page.has_more) return rows
    after = page.data.at(-1)?.id
    if (!after) throw new PayoutError('Stripe pagination could not be verified.')
  }
  throw new PayoutError('Too many Stripe pages. Choose a narrower report period.')
}

function assertPayout(payout, mode, expectedId) {
  if (payout?.object !== 'payout' || !/^po_[A-Za-z0-9]+$/.test(payout.id ?? '') ||
      (expectedId && payout.id !== expectedId) || payout.livemode !== (mode === 'live') ||
      !integer(payout.amount) || !currencies(payout.currency) ||
      !integer(payout.created) || payout.created < 0 || !integer(payout.arrival_date) || payout.arrival_date < 0 ||
      typeof payout.automatic !== 'boolean' || !['pending', 'in_transit', 'paid', 'failed', 'canceled'].includes(payout.status)) {
    throw new PayoutError('Stripe payout verification failed.')
  }
}

export async function payoutBalanceLine(row, stripe, mode) {
  if (!/^txn_[A-Za-z0-9]+$/.test(row?.id ?? '') || !integer(row.amount) || !integer(row.fee) || !integer(row.net) ||
      !integer(row.created) || row.created < 0 || !currencies(row.currency) || typeof row.type !== 'string' || !row.type) {
    throw new PayoutError('Stripe balance transaction verification failed.')
  }
  let source = row.source
  const sourceId = idOf(source) ?? null
  if (typeof source === 'string' && /^ch_[A-Za-z0-9]+$/.test(source)) source = await stripe(`/charges/${encodeURIComponent(source)}`, { method: 'GET' })
  if (typeof source === 'string' && /^re_[A-Za-z0-9]+$/.test(source)) source = await stripe(`/refunds/${encodeURIComponent(source)}`, { method: 'GET' })
  let issue = null
  const refundRestoration = row.amount > 0 && ['refund_failure', 'payment_refund'].includes(row.type)
  const failureTransaction = idOf(source?.failure_balance_transaction)
  if (source && typeof source === 'object') {
    if (source.id !== sourceId) throw new PayoutError('Stripe transaction source verification failed.')
    if (typeof source.livemode === 'boolean' && source.livemode !== (mode === 'live')) throw new PayoutError('Stripe transaction mode verification failed.')
    if (refundRestoration) {
      if (source.object !== 'refund' || failureTransaction !== row.id || !['failed', 'canceled'].includes(source.status)) {
        issue = 'Provider refund failure balance transaction not verified'
      }
    } else if (source.balance_transaction && idOf(source.balance_transaction) !== row.id) issue = 'Provider source balance transaction differs'
  }
  if (refundRestoration && (!source || typeof source !== 'object')) issue = 'Provider refund failure balance transaction not verified'
  const pi = source?.object === 'payment_intent' ? source.id : idOf(source?.payment_intent)
  const refund = source?.object === 'refund' || /^re_[A-Za-z0-9]+$/.test(sourceId ?? '') ? sourceId : null
  return { balance_transaction_id: row.id, created: row.created, type: row.type,
    reporting_category: typeof row.reporting_category === 'string' ? row.reporting_category : null,
    currency: row.currency, source_id: sourceId, payment_intent_id: /^pi_[A-Za-z0-9]+$/.test(pi ?? '') ? pi : null,
    refund_id: refund, failure_balance_transaction_id: /^txn_[A-Za-z0-9]+$/.test(failureTransaction ?? '') ? failureTransaction : null, amount_pence: row.amount, fee_pence: row.fee, net_pence: row.net, issue }
}

export async function runPayoutAction({ action, from, to, payoutId, profile, enabled, platformAccountId, mode,
  store, platformStripe, connectedStripe }) {
  authorizeConnection(profile, 'onboard', enabled)
  if (!['list', 'detail', 'refresh'].includes(action) || !/^acct_[A-Za-z0-9]+$/.test(platformAccountId ?? '') || !['test', 'live'].includes(mode)) {
    throw new PayoutError('Choose a valid payout action and configured provider mode.', 400)
  }
  if ((payoutId != null && !/^po_[A-Za-z0-9]+$/.test(payoutId)) || (action === 'detail' && !payoutId)) {
    throw new PayoutError('Choose a payout to inspect.', 400)
  }
  from ??= payoutId ? '1900-01-01' : undefined
  to ??= payoutId ? '2100-12-31' : undefined
  const bounds = londonDateBounds(from, to)
  const scope = { club_id: profile.club_id, platform_account_id: platformAccountId, livemode: mode === 'live' }
  if (action !== 'refresh') return store.report(scope, from, to, payoutId ?? null)
  const connection = await store.connection(scope)
  if (!connection?.stripe_account_id) throw new PayoutError('Connect the club Stripe account before refreshing payouts.', 409)
  if (connection.club_id !== scope.club_id || connection.platform_account_id !== platformAccountId || connection.livemode !== scope.livemode ||
      !/^acct_[A-Za-z0-9]+$/.test(connection.stripe_account_id)) throw new PayoutError('Club payout scope verification failed.')
  const platform = await platformStripe('/account', { method: 'GET' })
  if (platform?.id !== platformAccountId) throw new PayoutError('Stripe platform verification failed.')
  const stripe = connectedStripe(connection.stripe_account_id)
  const payouts = payoutId ? [await stripe(`/payouts/${encodeURIComponent(payoutId)}`, { method: 'GET' })]
    : await stripePages(stripe, '/payouts', { 'arrival_date[gte]': String(bounds.gte), 'arrival_date[lt]': String(bounds.lt) })
  for (const payout of payouts) {
    assertPayout(payout, mode, payoutId)
    const issues = [], lines = []
    if (payout.automatic) {
      const transactions = await stripePages(stripe, '/balance_transactions', { payout: payout.id, 'expand[]': 'data.source' })
      const ownBalanceId = idOf(payout.balance_transaction)
      for (const transaction of transactions) {
        const sourceId = idOf(transaction.source)
        // The payout itself can be returned alongside its components. Negative
        // payouts have a POSITIVE own settlement row. Exclude only the exact
        // identified transfer; retain all other payouts/failures as movements.
        const ownSettlement = transaction.type === 'payout' && (ownBalanceId
          ? transaction.id === ownBalanceId && (!sourceId || sourceId === payout.id)
          : sourceId === payout.id)
        if (!ownSettlement) lines.push(await payoutBalanceLine(transaction, stripe, mode))
      }
    } else issues.push('Manual payout components cannot be identified automatically')
    const complete = payout.automatic && payout.reconciliation_status === 'completed'
    if (payout.automatic && !complete) issues.push('Stripe has not completed automatic payout reconciliation')
    await store.save(scope, profile.id, payout, lines, complete, issues)
  }
  return store.report(scope, from, to, payoutId ?? null)
}
