import { test, expect } from '@playwright/test'
import { signIn, ADMIN, PLAYER } from './helpers.js'

// Critical authenticated flows. These hit the REAL Supabase backend, so they
// need test creds in env (E2E_ADMIN_*, E2E_PLAYER_*) and skip cleanly without
// them. Each exercises a real-browser concern jsdom can't: re-render after a
// write, the bottom-sheet history/popstate dance, viewport scroll.

test.describe('admin', () => {
  test.skip(!ADMIN.email, 'set E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD to run')

  test.beforeEach(async ({ page }) => {
    await signIn(page, ADMIN.email, ADMIN.password)
    await page.getByRole('button', { name: 'Manager view' }).click()
  })

  test('signs in and lands on Fixtures', async ({ page }) => {
    await expect(page.getByRole('button', { name: /add a fixture/i })).toBeVisible()
  })

  // Regression: styles/motion.css shipped `main, .app-header, .bottom-nav {
  // position: relative }` to lift content above the ambient field. It loads
  // after tokens.css, so it overrode the nav's `position: fixed` and the
  // header's `sticky` — the nav fell out of the viewport into the end of the
  // document flow and vanished off the bottom of the page. Every unit test
  // passed (vitest runs with css:false) and the nav was still in the DOM, so
  // only a real browser catches this: assert it is PINNED TO THE VIEWPORT after
  // scrolling, not merely present.
  test('the bottom nav stays pinned to the viewport after scrolling', async ({ page }) => {
    const nav = page.locator('.bottom-nav')
    await expect(nav).toBeVisible()
    await expect(nav).toHaveCSS('position', 'fixed')
    await expect(page.locator('.app-header')).toHaveCSS('position', 'sticky')

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(nav).toBeInViewport()

    // And it still sits above the page content, not behind it.
    const box = await nav.boundingBox()
    const vh = page.viewportSize().height
    expect(box.y + box.height).toBeLessThanOrEqual(vh + 1)
  })

  test('adds a fixture and it appears in the list (the 3×-broken bug)', async ({ page }) => {
    await page.getByRole('button', { name: /add a fixture/i }).click()
    const stamp = `E2E-${Date.now()}`
    await page.getByRole('group', { name: 'Team' }).getByRole('button', { name: 'Community' }).click()
    // New opponent (free-text), venue, a far-future date so it lands in upcoming.
    await page.getByPlaceholder('New opponent name').fill(stamp)
    await page.getByPlaceholder(/harvey hadden/i).fill('E2E Park')
    await page.locator('input[type="date"]').fill(new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10))
    await page.getByRole('button', { name: /^add fixture$/i }).click()
    // The sheet closes and the new game shows in the fixtures surface.
    await expect(page.getByText(stamp)).toBeVisible({ timeout: 10_000 })
  })

  test('logs a result and the game moves to Results', async ({ page }) => {
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
    await page.getByRole('spinbutton', { name: '1st Team score', exact: true }).fill('3')
    await page.getByRole('spinbutton', { name: stamp + ' score', exact: true }).fill('1')
    await page.getByRole('button', { name: /^log result$/i }).click()

    await expect(page.getByRole('dialog')).toBeHidden()
    const result = page.getByRole('button', { name: new RegExp(stamp) })
    await expect(result).toContainText(/3\s*[–−-]\s*1/)
  })
})

test.describe('player', () => {
  // The failed-read journey intercepts the fixture API. Service-worker-owned
  // requests bypass Playwright routing on a controlled WebKit reload.
  test.use({ serviceWorkers: 'block' })
  test.skip(!PLAYER.email, 'set E2E_PLAYER_EMAIL / E2E_PLAYER_PASSWORD to run')

  test('sets availability from the hero and the UI updates immediately', async ({ page }) => {
    await signIn(page, PLAYER.email, PLAYER.password)
    const inBtn = page.getByRole('button', { name: /^i'm in$/i }).first()
    await inBtn.tap()
    // Immediate reflection — the bug class in §2.2/§3.4 (write OK, UI stale).
    await expect(page.getByText(/saved|you're down as in/i)).toBeVisible({ timeout: 8_000 })
  })

  // Regression: "hang after login on Fixtures". A rejected fixtures read (the
  // "TypeError: Load failed" rejections logged in prod on /fixtures) used to
  // leave the "Pulling the fixtures…" loader stuck on forever. It must resolve
  // to a retry affordance instead, and recover when the network comes back.
  test('a failed fixtures load shows a retry, not an endless spinner', async ({ page }) => {
    await signIn(page, PLAYER.email, PLAYER.password)
    // Fail the fixtures read at the network layer, then reload so it fires on a
    // cold render — exactly the cold-start path users hit.
    await page.route('**/rest/v1/fixtures*', (r) => r.abort())
    await page.reload()
    await expect(page.getByText(/couldn't load fixtures/i)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('status', { name: 'Loading fixtures…' })).toBeHidden()
    // Recovery: stop failing, hit Try again, the fixtures surface loads.
    await page.unroute('**/rest/v1/fixtures*')
    await page.getByRole('button', { name: /try again/i }).click()
    await expect(page.getByText(/couldn't load fixtures/i)).toBeHidden({ timeout: 15_000 })
  })
})
