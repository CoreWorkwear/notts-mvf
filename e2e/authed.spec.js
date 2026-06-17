import { test, expect } from '@playwright/test'
import { signIn, ADMIN, PLAYER } from './helpers.js'

// Critical authenticated flows. These hit the REAL Supabase backend, so they
// need test creds in env (E2E_ADMIN_*, E2E_PLAYER_*) and skip cleanly without
// them. Each exercises a real-browser concern jsdom can't: re-render after a
// write, the bottom-sheet history/popstate dance, viewport scroll.

test.describe('admin', () => {
  test.skip(!ADMIN.email, 'set E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD to run')

  test('signs in and lands on Fixtures', async ({ page }) => {
    await signIn(page, ADMIN.email, ADMIN.password)
    await expect(page.getByRole('button', { name: /add a fixture/i })).toBeVisible()
  })

  test('adds a fixture and it appears in the list (the 3×-broken bug)', async ({ page }) => {
    await signIn(page, ADMIN.email, ADMIN.password)
    await page.getByRole('button', { name: /add a fixture/i }).click()
    const stamp = `E2E-${Date.now()}`
    // New opponent (free-text), venue, a far-future date so it lands in upcoming.
    await page.getByPlaceholder('New opponent name').fill(stamp)
    await page.getByPlaceholder(/harvey hadden/i).fill('E2E Park')
    await page.locator('input[type="date"]').fill('2027-05-01')
    await page.getByRole('button', { name: /^add fixture$/i }).click()
    // The sheet closes and the new game shows in the fixtures surface.
    await expect(page.getByText(stamp)).toBeVisible({ timeout: 10_000 })
  })

  test('logs a result and the game moves to Results', async ({ page }) => {
    await signIn(page, ADMIN.email, ADMIN.password)

    // Add a PAST-dated fixture so it's already concluded → "needs a result".
    const stamp = `E2E-RES-${Date.now()}`
    const past = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10)
    await page.getByRole('button', { name: /add a fixture/i }).click()
    await page.getByPlaceholder('New opponent name').fill(stamp)
    await page.getByPlaceholder(/harvey hadden/i).fill('E2E Park')
    await page.locator('input[type="date"]').fill(past)
    await page.getByRole('button', { name: /^add fixture$/i }).click()
    await expect(page.getByRole('button', { name: /^add fixture$/i })).toBeHidden() // sheet closed

    // Go to Results → the game is waiting in "Needs a result".
    await page.getByRole('link', { name: /results/i }).first().click()
    await page.getByRole('button', { name: new RegExp(stamp) }).click() // the needs-a-result row

    // Log 3–1 and save.
    await page.getByLabel('Our score').fill('3')
    await page.getByLabel('Their score').fill('1')
    await page.getByRole('button', { name: /^log result$/i }).click()

    // It saved and moved to Results — the form closed and a Won result is shown.
    await expect(page.getByRole('button', { name: /^log result$/i })).toBeHidden()
    await expect(page.getByText('Won')).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('player', () => {
  test.skip(!PLAYER.email, 'set E2E_PLAYER_EMAIL / E2E_PLAYER_PASSWORD to run')

  test('sets availability from the hero and the UI updates immediately', async ({ page }) => {
    await signIn(page, PLAYER.email, PLAYER.password)
    const inBtn = page.getByRole('button', { name: /^i'm in$/i }).first()
    await inBtn.click({ force: true }) // hero/weather still settling; we test the write+re-render, not layout
    // Immediate reflection — the bug class in §2.2/§3.4 (write OK, UI stale).
    await expect(page.getByText(/saved|you're down as in/i)).toBeVisible({ timeout: 8_000 })
  })
})
