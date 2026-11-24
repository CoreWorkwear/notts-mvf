import { randomUUID } from 'node:crypto'
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
