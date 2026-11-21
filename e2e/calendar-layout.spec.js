import { expect, test } from '@playwright/test'
import { loadEnv } from 'vite'
import { nextOpponent, signInAsAuditMember } from './mobileAuditData.js'

test.use({ serviceWorkers: 'block', viewport: { width: 280, height: 653 } })

test('a narrow phone keeps the calendar on the page and every fixture day reachable', async ({ page }) => {
  const origin = loadEnv('production', process.cwd(), 'VITE_').VITE_SUPABASE_URL
  await signInAsAuditMember(page, 'player', origin)
  await page.goto('/fixtures')
  await expect(page.getByRole('heading', { name: nextOpponent })).toBeVisible()
  await page.getByRole('tab', { name: 'Calendar' }).tap()
  await page.getByRole('button', { name: 'Next month' }).waitFor()
  for (const width of [360, 280]) {
    await page.setViewportSize({ width, height: 653 })
    for (const scale of [100, 150, 200]) {
      await page.evaluate(scale => document.documentElement.style.setProperty('font-size', scale + '%', 'important'), scale)
      const outside = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(outside, `${width}px at ${scale}% text`).toBeLessThanOrEqual(1)
    }
  }
  const month = page.getByRole('region', { name: /calendar/i })
  await month.evaluate(el => { el.scrollLeft = el.scrollWidth })
  expect(await month.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
  const day = month.getByRole('button').and(page.locator('.cal-cell.has')).first()
  await day.scrollIntoViewIfNeeded()
  const box = await day.boundingBox()
  expect(box.width).toBeGreaterThanOrEqual(48)
  expect(box.height).toBeGreaterThanOrEqual(48)
  await day.tap()
  await expect(page.getByRole('dialog')).toBeVisible()
})
