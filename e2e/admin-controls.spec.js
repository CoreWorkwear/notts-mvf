import { expect, test } from '@playwright/test'
import { loadEnv } from 'vite'
import { signInAsAuditMember } from './mobileAuditData.js'

test.use({ serviceWorkers: 'block', viewport: { width: 280, height: 653 } })

test.beforeEach(async ({ page }) => {
  const origin = loadEnv('production', process.cwd(), 'VITE_').VITE_SUPABASE_URL
  await signInAsAuditMember(page, 'manager', origin)
})

async function checkTarget(page, control) {
  await control.waitFor({ state: 'visible' })
  for (const scale of [100, 200]) {
    await page.evaluate(scale => document.documentElement.style.fontSize = scale + '%', scale)
    await control.scrollIntoViewIfNeeded()
    const box = await control.boundingBox()
    expect(box.width).toBeGreaterThanOrEqual(48)
    expect(box.height).toBeGreaterThanOrEqual(48)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(280)
  }
}

test('each sponsor has separate keyboard and touch actions', async ({ page }) => {
  await page.goto('/sponsors')
  const remove = page.getByRole('button', { name: /remove/i })
  await checkTarget(page, remove)
  const edit = page.getByRole('button', { name: /edit radford sports/i })
  await checkTarget(page, edit)
  await edit.focus()
  await page.keyboard.press('Tab')
  await expect(remove).toBeFocused()
  const confirm = page.waitForEvent('dialog').then(async d => {
    expect(d.message()).toMatch(/remove radford sports/i)
    await d.dismiss()
  })
  await Promise.all([confirm, page.keyboard.press('Space')])
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await edit.tap()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('the session breadcrumbs have a full touch target and keyboard disclosure', async ({ page }) => {
  await page.goto('/diagnostics')
  const summary = page.locator('summary').filter({ hasText: 'Breadcrumbs this session' })
  await checkTarget(page, summary)
  await summary.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('details[open] summary')).toBeVisible()
  await summary.tap()
  await expect(page.locator('details[open]')).toHaveCount(0)
})
