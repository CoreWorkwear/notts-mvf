import { test, expect } from '@playwright/test'
import { signInAsStubPlayer } from './stubSupabase.js'

// Migration 0039: an account the manager hasn't signed off (player or
// supporter), or one that's been switched off, can read nothing club-wide. The
// app must show it the holding screen, not a shell full of empty lists and
// failed loads, and must not even ask for club data. Runs against the stubbed
// Supabase, so it needs no creds and runs in CI on both engines.

test.use({ serviceWorkers: 'block' })

// Club tables a held account must never request. Its own profile (and, via
// AuthContext, its own private row and memberships) is fine.
const CLUB_TABLES = ['fixtures', 'results', 'seasons', 'teams', 'availability', 'lineups', 'announcements', 'sponsors', 'competitions', 'opponents', 'payments', 'training_sessions', 'training_notices']

for (const [label, profile, headline] of [
  ['a pending player', { approved: false }, 'Awaiting manager sign-off'],
  ['a pending supporter', { approved: false, is_player: false }, 'Awaiting manager sign-off'],
  ['a switched-off player', { active: false }, 'Account inactive'],
]) {
  test(`${label} gets the holding screen and asks for no club data`, async ({ page }) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    const seen = await signInAsStubPlayer(page, { profile })

    await page.goto('/fixtures')
    await expect(page.getByRole('heading', { name: headline })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
    await expect(page.locator('.bottom-nav')).toHaveCount(0)
    if (profile.is_player === false) await expect(page.getByText('Supporter', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Check again' }).click()
    await expect(page.getByRole('heading', { name: headline })).toBeVisible()

    expect(seen.filter((t) => CLUB_TABLES.includes(t))).toEqual([])
    expect(errors).toEqual([])
  })
}
