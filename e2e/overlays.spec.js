import { test, expect } from '@playwright/test'
import { signInAsStubPlayer, STUB } from './stubSupabase.js'

// Sheets, toasts and full-screen overlays all render INSIDE <main>, and sit on
// top of the header and bottom nav (z-index 50) only by being position: fixed
// with a higher z-index: sheet 100, toast 200. A z-index on <main> itself
// (styles/motion.css) capped every one of them at main's level. The nav covered
// every sheet's save button and the header covered every error toast, on Android
// and iPhone alike: players couldn't save their own details, and couldn't read
// why when a save was refused. Every unit test stayed green throughout, because
// vitest runs css:false and the DOM was never wrong.
//
// This needs a real browser and a signed-in app but not real data, so it runs
// against a stubbed Supabase and, unlike authed.spec.js, runs in CI on both
// engines. styles/stacking.test.js guards the same rule from the unit suite.

// page.route() can't see requests a service worker answers.
test.use({ serviceWorkers: 'block' })

// What a thumb would hit in the middle of `locator`: 'itself' when it (or a
// child) is topmost there, 'the sheet' when an open sheet's layer is, otherwise
// the tag.class of whatever is sitting on top of it.
function topmostAt(locator) {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    if (!hit) return 'nothing'
    if (el.contains(hit)) return 'itself'
    if (hit.closest('.sheet-backdrop')) return 'the sheet'
    return hit.tagName.toLowerCase() + [...hit.classList].map((c) => '.' + c).join('')
  })
}

test.describe('an open sheet sits above the app chrome', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsStubPlayer(page)
    await page.goto('/you')
    // The edit sheet refuses to open until the private details have loaded.
    await expect(page.getByText(STUB.phone)).toBeVisible()
    await page.getByRole('button', { name: 'Edit your details' }).click()
    // Let the spring entrance finish first. While the sheet carries a transform
    // it is the containing block for the fixed toast inside it, so the toast
    // rides up the screen with the sheet instead of sitting at the top, and a
    // check run mid-flight passes even with the header on top of it. (A sheet
    // that never settles to `none` would do that permanently, so this fails too.)
    await expect(page.getByRole('dialog')).toHaveCSS('transform', 'none')
  })

  // Each check polls for the settled state. For ~160ms after a route loads the
  // page is still fading in, and an element at opacity < 1 is a stacking
  // context, so a sheet opened that fast really is under the nav until the fade
  // ends. No thumb is that quick; a test against a stubbed backend is. (A
  // transient can only make a correct build look broken here, never the
  // reverse: the sheet's own transient is handled by the transform wait above.)
  test('it covers the header and the bottom nav', async ({ page }) => {
    await expect.poll(() => topmostAt(page.locator('.app-header'))).toBe('the sheet')
    await expect.poll(() => topmostAt(page.locator('.bottom-nav'))).toBe('the sheet')
  })

  test('its save button takes the tap, not the nav', async ({ page }) => {
    const save = page.getByRole('button', { name: 'Save changes' })
    await save.scrollIntoViewIfNeeded()
    await expect.poll(() => topmostAt(save)).toBe('itself')
    await save.tap() // refused outright if another element would receive it
    await expect(page.getByRole('dialog')).toBeHidden() // saved, so the sheet closes
  })

  test('a validation error raised inside it shows above the header', async ({ page }) => {
    // Enter submits the form, so this doesn't depend on Save being reachable.
    const firstName = page.getByRole('dialog').getByRole('textbox').first()
    await firstName.fill('')
    await firstName.press('Enter')
    const toast = page.getByRole('alert').filter({ hasText: 'First name is required.' })
    await expect(toast).toBeVisible()
    // Inside the 4s the toast stays up, so a failure reports what covers it.
    await expect.poll(() => topmostAt(toast), { timeout: 3000 }).toBe('itself')
  })
})
