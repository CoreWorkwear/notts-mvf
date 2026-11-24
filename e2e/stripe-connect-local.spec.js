import { createHmac, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { loadEnv } from 'vite'
import { signIn } from './helpers.js'

const sandbox = process.env.E2E_STRIPE_SANDBOX === '1'
const env = loadEnv('production', process.cwd(), 'VITE_')
const clubId = '11111111-1111-1111-1111-111111111111'
const options = { auth: { persistSession: false, autoRefreshToken: false } }

test.use({ actionTimeout: 10_000, serviceWorkers: 'block', trace: 'off', screenshot: 'off' })

async function checked(request) {
  const { data, error } = await request
  if (error) throw new Error(error.message)
  return data
}

test('manager starts and resumes sandbox onboarding from Club settings', async ({ page }) => {
  test.skip(!sandbox, 'requires the isolated Stripe sandbox Edge Function')
  expect(env.VITE_SUPABASE_URL).toBe('http://127.0.0.1:55421')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  expect(Boolean(key)).toBe(true)
  const admin = createClient(env.VITE_SUPABASE_URL, key, options)
  const email = `stripe-proof-${randomUUID()}@example.com`
  const password = randomUUID()
  const { user } = await checked(admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { first_name: 'Sandbox', last_name: 'Manager', phone: '07700900912' },
  }))
  try {
    await checked(admin.from('profiles').update({ active: true, approved: true, role: 'admin' }).eq('id', user.id))
    await checked(admin.rpc('set_club_payments_release', { p_club_id: clubId, p_enabled: true, p_cutover: true }))
    await signIn(page, email, password)
    await page.getByRole('button', { name: 'Manager view' }).click()
    await page.goto('/manage')
    await page.getByRole('link', { name: 'Stripe', exact: true }).click()
    await expect(page.getByText('Sandbox', { exact: true })).toBeVisible()

    // The Edge Function performs the real sandbox calls. Leave the hosted
    // page unopened so the account holder can obtain a fresh single-use link.
    let hostedLinks = 0
    await page.route(/^https:\/\/(accounts|connect)\.stripe\.com\//, async route => {
      hostedLinks += 1
      return route.fulfill({ body: 'Stripe onboarding redirect verified.' })
    })
    const launch = page.getByRole('button', { name: /^(Set up Stripe|Continue Stripe setup)$/ })
    await launch.tap()
    await expect(page.getByText('Stripe onboarding redirect verified.')).toBeVisible({ timeout: 20_000 })
    expect(hostedLinks).toBe(1)
    const first = await checked(admin.from('club_stripe_connections').select('stripe_account_id,livemode')
      .eq('club_id', clubId).eq('livemode', false).single())
    expect(first.stripe_account_id).toMatch(/^acct_/)
    expect(first.livemode).toBe(false)

    await page.goto('http://localhost:4173/manage/settings/stripe?stripe=return')
    await expect(page.getByRole('heading', { name: 'Stripe setup incomplete' })).toBeVisible()
    await page.getByRole('button', { name: 'Continue Stripe setup' }).tap()
    await expect(page.getByText('Stripe onboarding redirect verified.')).toBeVisible({ timeout: 20_000 })
    expect(hostedLinks).toBe(2)
    const after = await checked(admin.from('club_stripe_connections').select('stripe_account_id')
      .eq('club_id', clubId).eq('livemode', false).single())
    expect(after.stripe_account_id).toBe(first.stripe_account_id)
  } finally {
    await checked(admin.rpc('set_club_payments_release', { p_club_id: clubId, p_enabled: false }))
    await checked(admin.auth.admin.deleteUser(user.id))
  }
})

test('signed sandbox fixtures settle, refund and record payout status even while paused', async ({ page }) => {
  test.skip(process.env.E2E_STRIPE_SIGNED_FIXTURES !== '1', 'requires the isolated signed-event endpoint')
  expect(env.VITE_SUPABASE_URL).toBe('http://127.0.0.1:55421')
  const api = env.VITE_SUPABASE_URL
  const platform = process.env.STRIPE_PLATFORM_ACCOUNT_ID
  const signingSecret = process.env.STRIPE_WEBHOOK_SECRET_CONNECT
  expect(platform).toMatch(/^acct_/)
  expect(Boolean(signingSecret?.startsWith('whsec_'))).toBe(true)
  const admin = createClient(api, process.env.SUPABASE_SERVICE_ROLE_KEY, options)
  const people = []
  let fixtureClub
  let enabled = false
  const stamp = randomUUID().replaceAll('-', '')
  const fakeAccount = `acct_Proof${stamp}`
  const fakeCustomer = `cus_Proof${stamp}`
  const fakeIntent = `pi_Proof${stamp}`
  const fakeSession = `cs_test_Proof${stamp}`
  const attemptId = randomUUID()
  const callback = 'http://localhost:4173/you'

  async function makeUser(role) {
    const email = `signed-proof-${randomUUID()}@example.com`
    const password = randomUUID()
    const { user } = await checked(admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { first_name: 'Signed', last_name: 'Fixture', phone: '07700900912' },
    }))
    people.push(user.id)
    await checked(admin.from('profiles').update({
      approved: true, active: true, club_id: fixtureClub.id, role,
    }).eq('id', user.id))
    return { id: user.id, email, password }
  }

  async function enable(value) {
    await checked(admin.rpc('set_club_payments_release', { p_club_id: fixtureClub.id, p_enabled: value, p_cutover: value }))
    enabled = value
  }

  function event(type, id, object) {
    return { id: `evt_${id}${stamp}`, type, livemode: false, account: fakeAccount,
      created: Math.floor(Date.now() / 1000), data: { object: { ...object, livemode: false } } }
  }

  function deliver(payload, valid = true) {
    const body = JSON.stringify(payload)
    const timestamp = Math.floor(Date.now() / 1000)
    const digest = valid ? createHmac('sha256', signingSecret).update(`${timestamp}.${body}`).digest('hex') : '0'.repeat(64)
    return fetch(`${api}/functions/v1/stripe-connect-webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${timestamp},v1=${digest}` }, body,
    })
  }

  try {
    fixtureClub = await checked(admin.from('clubs').insert({ name: 'Stripe signed fixture' }).select('id').single())
    const manager = await makeUser('admin')
    const player = await makeUser('player')
    await enable(true)
    const connection = await checked(admin.rpc('reserve_club_stripe_connection', {
      p_club_id: fixtureClub.id, p_platform_account_id: platform, p_livemode: false, p_actor_id: manager.id,
    }))
    await checked(admin.rpc('save_club_stripe_connection', {
      p_club_id: fixtureClub.id, p_platform_account_id: platform, p_livemode: false,
      p_creation_id: connection.creation_id, p_account_id: fakeAccount,
      p_status: { charges_enabled: true, payouts_enabled: true },
    }))
    await checked(admin.rpc('post_account_entry', { p_entry: {
      club_id: fixtureClub.id, profile_id: player.id, kind: 'opening', source: 'opening', amount_pence: -900,
      description: 'Opening balance', source_id: stamp,
    } }))
    const reservation = await checked(admin.rpc('reserve_stripe_checkout', {
      p_attempt_id: attemptId, p_club_id: fixtureClub.id, p_actor_id: player.id, p_platform_account_id: platform,
      p_livemode: false, p_kind: 'balance', p_amount_pence: 900, p_success_url: callback, p_cancel_url: callback,
    }))
    await checked(admin.rpc('bind_stripe_player_customer', {
      p_creation_id: reservation.customer.creation_id, p_customer_id: fakeCustomer,
    }))
    await checked(admin.rpc('bind_stripe_checkout_session', {
      p_attempt_id: attemptId, p_customer_id: fakeCustomer, p_session_id: fakeSession, p_checkout_url: null,
    }))
    const metadata = {
      club_id: fixtureClub.id, profile_id: player.id, player_account_id: reservation.attempt.player_account_id,
      platform_account_id: platform, attempt_id: attemptId, provider_mode: 'test',
    }
    const payment = event('payment_intent.succeeded', 'Payment', {
      object: 'payment_intent', id: fakeIntent, amount: 900, amount_received: 900,
      currency: 'gbp', status: 'succeeded', customer: fakeCustomer, metadata,
    })
    const checkout = event('checkout.session.completed', 'Checkout', {
      object: 'checkout.session', mode: 'payment', id: fakeSession, payment_intent: fakeIntent, amount_total: 900,
      currency: 'gbp', payment_status: 'paid', customer: fakeCustomer, metadata,
    })
    const refund = event('refund.updated', 'Refund', {
      object: 'refund', id: `re_Proof${stamp}`, amount: 200, currency: 'gbp', status: 'succeeded', payment_intent: fakeIntent,
    })
    const payoutTime = Math.floor(Date.now() / 1000)
    const failedPayout = event('payout.failed', 'Payout', {
      object: 'payout', id: `po_Proof${stamp}`, status: 'failed', amount: 640, currency: 'gbp',
      arrival_date: payoutTime, created: payoutTime, automatic: true, reconciliation_status: 'pending',
      failure_code: 'account_closed',
    })
    await enable(false)
    expect((await deliver(payment, false)).status).toBe(400)
    expect((await deliver(refund)).status).toBe(503)
    const results = await Promise.all([deliver(payment), deliver(checkout), deliver(payment)])
    expect(results.map(result => result.status)).toEqual([200, 200, 200])
    expect((await deliver(refund)).status).toBe(200)
    expect((await deliver(refund)).status).toBe(200)
    expect((await deliver(failedPayout)).status).toBe(200)
    expect((await deliver(failedPayout)).status).toBe(200)
    await enable(true)
    const playerClient = createClient(api, env.VITE_SUPABASE_ANON_KEY, options)
    await checked(playerClient.auth.signInWithPassword({ email: player.email, password: player.password }))
    const statement = await checked(playerClient.rpc('get_player_account'))
    expect(statement.balance_pence).toBe(-200)
    expect(statement.entries.map(entry => [entry.kind, entry.amount_pence])).toEqual([
      ['opening', -900], ['receipt', 900], ['refund', -200],
    ])
    expect(statement.entries[2].linked_entry_id).toBe(statement.entries[1].id)
    const today = new Date().toISOString().slice(0, 10)
    const denied = await playerClient.functions.invoke('stripe-payout-reconciliation', {
      body: { action: 'list', from: today, to: today },
    })
    expect(denied.error?.context?.status).toBe(403)
    await signIn(page, manager.email, manager.password)
    await page.getByRole('button', { name: 'Manager view' }).click()
    await page.goto('/manage')
    await page.getByRole('link', { name: 'Stripe payouts', exact: true }).tap()
    const payout = page.getByText(/Failed payout · £6.40/)
    await expect(payout).toHaveCount(1)
    await payout.tap()
    await expect(page.getByText('Reconciliation outstanding')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export payout CSV' })).toBeVisible()
  } finally {
    if (enabled) await enable(false)
    for (const id of people) await checked(admin.auth.admin.deleteUser(id))
  }
})
