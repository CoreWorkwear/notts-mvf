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
    const stamp = `E2E ${Date.now()}`
    // Opponent free-text, venue, a near-future date so it lands in upcoming.
    await page.getByLabel(/opponent/i).fill(stamp)
    await page.getByLabel(/venue/i).first().fill('E2E Park')
    await page.getByLabel(/date/i).fill('2027-05-01')
    await page.getByRole('button', { name: /save|add fixture/i }).click()
    // The sheet closes and the new opponent shows in the fixtures surface.
    await expect(page.getByText(stamp)).toBeVisible({ timeout: 10_000 })
  })

  test('logs a result and the game moves to Results', async ({ page }) => {
    await signIn(page, ADMIN.email, ADMIN.password)
    // Flow depends on having a kicked-off fixture; covered manually until seeded.
    test.fixme(true, 'needs a deterministic concluded fixture seeded for E2E')
  })
})

test.describe('player', () => {
  test.skip(!PLAYER.email, 'set E2E_PLAYER_EMAIL / E2E_PLAYER_PASSWORD to run')

  test('sets availability from the hero and the UI updates immediately', async ({ page }) => {
    await signIn(page, PLAYER.email, PLAYER.password)
    const inBtn = page.getByRole('button', { name: /^i'm in$/i }).first()
    await inBtn.click()
    // Immediate reflection — the bug class in §2.2/§3.4 (write OK, UI stale).
    await expect(page.getByText(/saved|you're down as in/i)).toBeVisible({ timeout: 8_000 })
  })
})
