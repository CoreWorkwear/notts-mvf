import { test, expect } from '@playwright/test'
import { signInAsStubPlayer, STUB } from './stubSupabase.js'

// Pitch-side cold start: the app was last open more than an hour ago, so the
// access token has expired and supabase-js must refresh it before there is a
// session, and there is no signal to do it with. The app used to read "no
// session yet" as "signed out" and put the sign-in form in front of a signed-in
// player; when signal returned, the refresh arrived as TOKEN_REFRESHED, which
// was skipped, so the app came up with no profile (a blank You, "Availability
// is closed for this one") until the next trip to the background.
//
// The unit tests mock supabase-js. This runs the real client against a token
// endpoint that is down and then comes back, on both phone engines.

test.use({ serviceWorkers: 'block' })

test('expired token and no signal: a reconnect screen, then the app with the profile', async ({ page }) => {
  const net = { authDown: true }
  await signInAsStubPlayer(page, { expired: true, net })
  await page.goto('/you')

  // The splash lifts on its safety timer (6s) with the refresh still out.
  const stranded = page.getByRole('alert').filter({ hasText: "Can't reach the club" })
  await expect(stranded).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('tab', { name: /join up/i })).toHaveCount(0) // not the sign-in form
  await expect(page.getByLabel('Password')).toHaveCount(0)

  // Signal comes back. supabase-js is still retrying on its own, so the app may
  // appear before the tap lands: only tap if the screen is still there.
  net.authDown = false
  const again = page.getByRole('button', { name: /try again|trying/i })
  if (await again.isVisible().catch(() => false)) await again.click({ timeout: 2000 }).catch(() => {})

  // The You page needs the PROFILE, not just a session: the name comes from
  // profiles, the phone number from the private row keyed on it.
  await expect(page.getByRole('heading', { name: `${STUB.firstName} ${STUB.lastName}` })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(STUB.phone)).toBeVisible()
  await expect(stranded).toBeHidden()
})

test('signed out with nothing stored still lands on the sign-in form', async ({ page }) => {
  await page.goto('/you')
  await expect(page.getByRole('tab', { name: /join up/i })).toBeVisible()
  await expect(page.getByText("Can't reach the club")).toHaveCount(0)
})
