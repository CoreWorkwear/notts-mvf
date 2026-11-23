import { expect, test } from '@playwright/test'
import { loadEnv } from 'vite'
import { signInAsAuditMember } from './mobileAuditData.js'

const origin = loadEnv('production', process.cwd(), 'VITE_').VITE_SUPABASE_URL
test.use({ serviceWorkers: 'block', viewport: { width: 375, height: 640 } })

test('Back restores the fixture list position after the returning list has loaded', async ({ page }) => {
  await signInAsAuditMember(page, 'player', origin)
  await page.goto('/fixtures')
  await expect(page.getByRole('heading', { name: 'Upcoming' })).toBeVisible()
  const position = () => page.evaluate(() => window.scrollY)
  await page.evaluate(() => window.scrollTo(0, 380))
  const before = await position()
  expect(before).toBeGreaterThan(100)
  await page.getByRole('link', { name: 'You', exact: true }).tap()
  await expect(page.getByRole('heading', { name: 'Sam Marshall' })).toBeVisible()
  await expect.poll(position).toBe(0)

  let release
  const gate = new Promise(resolve => { release = resolve })
  await page.route('**/rest/v1/fixtures?**', async route => {
    await gate
    await route.fallback()
  })
  const request = page.waitForRequest('**/rest/v1/fixtures?**')
  await page.goBack()
  await request
  release()
  await expect(page.getByRole('heading', { name: 'Upcoming' })).toBeVisible()
  await expect.poll(position).toBe(before)
})

test('a short pull settles the sheet and a downward drag dismisses it', async ({ page }) => {
  await signInAsAuditMember(page, 'player', origin)
  await page.goto('/you')
  await expect(page.getByText('+447700900123')).toBeVisible()
  const opener = page.getByRole('button', { name: 'Edit your details' })
  await opener.tap()
  const dialog = page.getByRole('dialog')
  const grip = dialog.locator('.grab-handle')
  for (const distance of [10, 125]) {
    const box = await grip.boundingBox()
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + distance, { steps: 12 })
    await page.mouse.up()
    if (distance === 10) {
      await expect(dialog).toBeVisible()
      await expect(dialog).toHaveCSS('transform', 'none')
    }
  }
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()
})
