import { expect } from '@playwright/test'

// Sign in via the real login form and wait until the app shell is up (the
// sign-in / join tabs are gone once authenticated).
export async function signIn(page, email, password) {
  await page.goto('/')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /^sign in$/i }).click()
  await expect(page.getByRole('button', { name: /join up/i })).toBeHidden({ timeout: 15_000 })
}

// Env-driven creds; specs use these to skip when not provided.
export const ADMIN = { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD }
export const PLAYER = { email: process.env.E2E_PLAYER_EMAIL, password: process.env.E2E_PLAYER_PASSWORD }
