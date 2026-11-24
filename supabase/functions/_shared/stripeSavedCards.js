import { ConnectError, assertAccountScope } from './stripeConnect.js'

export class SavedCardError extends ConnectError {
  constructor(message, status = 400) { super(message, status) }
}

const encode = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
function decode(value) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new SavedCardError('Saved card reference is invalid.', 403)
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='), char => char.charCodeAt(0))
}
function tokenMessage(row, methodId) {
  return new TextEncoder().encode(JSON.stringify(['saved-card-remove:v1', row.club_id, row.profile_id,
    row.platform_account_id, row.livemode, row.stripe_account_id, row.stripe_customer_id, methodId]))
}
async function tokenKey(secret) {
  if (!secret) throw new ConnectError('Saved card controls are not configured.')
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}
export async function savedCardToken(row, methodId, secret) {
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await tokenKey(secret), tokenMessage(row, methodId)))
  return `v1.${methodId}.${encode(signature)}`
}
export async function verifySavedCardToken(row, token, secret) {
  const parts = typeof token === 'string' ? token.split('.') : []
  if (parts.length !== 3 || parts[0] !== 'v1' || !/^pm_[A-Za-z0-9]+$/.test(parts[1])) {
    throw new SavedCardError('Saved card reference is invalid.', 403)
  }
  let valid = false
  try { valid = await crypto.subtle.verify('HMAC', await tokenKey(secret), decode(parts[2]), tokenMessage(row, parts[1])) } catch {}
  if (!valid) throw new SavedCardError('Saved card reference is invalid.', 403)
  return parts[1]
}

function assertCustomer(customer, row) {
  const metadata = { club_id: row.club_id, profile_id: row.profile_id, platform_account_id: row.platform_account_id,
    provider_mode: row.livemode ? 'live' : 'test', customer_creation_id: row.creation_id }
  if (customer?.id !== row.stripe_customer_id || customer.deleted || customer.livemode !== row.livemode ||
    Object.entries(metadata).some(([key, value]) => customer.metadata?.[key] !== value)) {
    throw new ConnectError('Saved card customer verification failed.')
  }
}
function assertCard(method, row, allowDetached = false) {
  if (!/^pm_[A-Za-z0-9]+$/.test(method?.id ?? '') || method.type !== 'card' || method.livemode !== row.livemode ||
    !(method.customer === row.stripe_customer_id || (allowDetached && method.customer === null))) {
    throw new SavedCardError('Saved card is outside your player account.', 403)
  }
}

export async function runSavedCardsAction({ body, profile, enabled, mode, stripe, connectedStripe, store, secret }) {
  if (!['list', 'remove'].includes(body?.action)) throw new SavedCardError('Choose a valid saved card action.')
  if (!enabled || !profile?.id || !profile.club_id || profile.approved !== true || profile.active !== true || profile.is_player !== true) {
    throw new SavedCardError('Saved card controls are unavailable.', 403)
  }
  if (body.action === 'remove' && body.confirmed !== true) throw new SavedCardError('Confirm removal of the saved card.')
  const platform = await stripe('/account')
  if (!/^acct_[A-Za-z0-9]+$/.test(platform?.id ?? '')) throw new ConnectError('Stripe platform verification failed.')
  const scope = { club_id: profile.club_id, profile_id: profile.id, platform_account_id: platform.id, livemode: mode === 'live' }
  const connection = await store.connection(scope)
  if (!connection?.stripe_account_id) {
    if (body.action === 'list') return { cards: [] }
    throw new SavedCardError('Saved card not found.', 404)
  }
  const providerAccount = await stripe(`/accounts/${encodeURIComponent(connection.stripe_account_id)}`)
  assertAccountScope(providerAccount, connection)
  const row = await store.customer(scope)
  if (!row?.stripe_customer_id) {
    if (body.action === 'list') return { cards: [] }
    throw new SavedCardError('Saved card not found.', 404)
  }
  if (row.club_id !== scope.club_id || row.profile_id !== scope.profile_id || row.platform_account_id !== scope.platform_account_id ||
    row.livemode !== scope.livemode || row.stripe_account_id !== connection.stripe_account_id) {
    throw new ConnectError('Saved card account verification failed.')
  }
  const direct = connectedStripe(row.stripe_account_id)
  assertCustomer(await direct(`/customers/${encodeURIComponent(row.stripe_customer_id)}`), row)
  if (body.action === 'remove') {
    const id = await verifySavedCardToken(row, body.id, secret)
    const method = await direct(`/payment_methods/${encodeURIComponent(id)}`)
    if (method?.id !== id) throw new SavedCardError('Saved card reference is invalid.', 403)
    assertCard(method, row, true)
    // The scoped token proves the card belonged to this caller when listed.
    // A repeated removal does nothing; unattached methods cannot be reused.
    if (method.customer === null) return { removed: true }
    const removed = await direct(`/payment_methods/${encodeURIComponent(id)}/detach`, {
      method: 'POST', idempotencyKey: `remove-card:${row.creation_id}:${id}`,
    })
    if (removed?.id !== id || removed.customer !== null) throw new ConnectError('Stripe could not confirm saved card removal.')
    return { removed: true }
  }
  const cards = []
  let after
  do {
    const query = new URLSearchParams({ customer: row.stripe_customer_id, type: 'card', allow_redisplay: 'always', limit: '100',
      ...(after ? { starting_after: after } : {}) })
    const page = await direct(`/payment_methods?${query}`)
    if (!Array.isArray(page.data)) throw new ConnectError('Stripe returned an invalid saved card response.')
    for (const method of page.data) {
      assertCard(method, row)
      if (typeof method.card?.brand !== 'string' || !/^\d{4}$/.test(method.card?.last4 ?? '')) {
        throw new ConnectError('Stripe returned an invalid saved card response.')
      }
      cards.push({ id: await savedCardToken(row, method.id, secret), brand: method.card.brand, last4: method.card.last4 })
    }
    after = page.has_more ? page.data.at(-1)?.id : null
    if (page.has_more && !after) throw new ConnectError('Stripe returned an invalid saved card response.')
  } while (after)
  return { cards }
}
