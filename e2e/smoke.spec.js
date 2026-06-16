import { test, expect } from '@playwright/test'

// No-auth smoke layer — proves the real production bundle boots and renders in a
// browser, and (critically) that a blocked form submit shows a VISIBLE,
// in-viewport error. That last one is a permanent regression guard for the
// "validation error rendered off-screen at the top of a long sheet" class of bug
// that jsdom never caught.

test('the app boots to the sign-in screen', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /notts mvf/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /join up/i })).toBeVisible()
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByRole('button', { name: /forgot password/i })).toBeVisible()
})

test('register validation surfaces a VISIBLE, in-viewport error', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /join up/i }).click()
  // Submit with everything empty.
  await page.getByRole('button', { name: /join the squad/i }).click()
  const err = page.getByText(/first name, surname, email, phone and password are all needed/i)
  await expect(err).toBeVisible()
  await expect(err).toBeInViewport() // the off-screen-error regression guard
})

test('a player can switch to "supporter" and the team picker disappears', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /join up/i }).click()
  await expect(page.getByText(/which team\(s\)\?/i)).toBeVisible() // player default
  await page.getByRole('button', { name: /a supporter/i }).click()
  await expect(page.getByText(/which team\(s\)\?/i)).toBeHidden() // supporters pick no team
})
