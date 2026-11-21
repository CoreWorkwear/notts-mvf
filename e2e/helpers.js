import { expect } from '@playwright/test'
import { ciPlaceholder } from './users.js'

// Sign in via the real login form and wait until the app shell is up (the
// sign-in / join tabs are gone once authenticated).
export async function signIn(page, email, password) {
  await page.goto('/')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  // The submit button (inside the form), not the "Sign in" tab.
  await page.locator('form').getByRole('button', { name: /^sign in$/i }).click()
  // "Join up" is a tab in the Segmented control (role="tab"), not a button. Keep
  // this lookup matching the real control: one that matches nothing counts as
  // "hidden" straight away, and signIn() would return before sign-in had landed.
  await expect(page.getByRole('tab', { name: /join up/i })).toBeHidden({ timeout: 15_000 })
}

// Env-driven creds; specs use these to skip when not provided.
// Blank on the CI placeholder build (no project behind it), so the authed specs skip.
const creds = (e, p) => (ciPlaceholder() ? {} : { email: process.env[e], password: process.env[p] })
export const ADMIN = creds('E2E_ADMIN_EMAIL', 'E2E_ADMIN_PASSWORD')
export const PLAYER = creds('E2E_PLAYER_EMAIL', 'E2E_PLAYER_PASSWORD')
