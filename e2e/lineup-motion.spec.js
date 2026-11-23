import { expect, test } from '@playwright/test'
import { loadEnv } from 'vite'
import { signInAsAuditMember } from './mobileAuditData.js'

test.use({ serviceWorkers: 'block', contextOptions: { reducedMotion: 'no-preference' } })

async function openEditor(page) {
  const origin = loadEnv('production', process.cwd(), 'VITE_').VITE_SUPABASE_URL
  await signInAsAuditMember(page, 'manager', origin)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'vibrate', { value: undefined })
    const animate = Element.prototype.animate
    Element.prototype.animate = function (frames, timing) {
      if (Array.isArray(frames) && frames.some(frame => frame.scale === '.975')) {
        window.feedbackTarget = this.getAttribute('aria-label') || this.textContent.trim()
      }
      return animate.call(this, frames, timing)
    }
  })
  await page.goto('/fixtures')
  await page.locator('.hero').getByRole('button', { name: /^Line-up/ }).tap()
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('button', { name: 'Pick the line-up' }).tap()
  await sheet.getByRole('button', { name: 'GK, pick a player' }).tap()
  await sheet.getByRole('group', { name: 'Pick a player' }).getByRole('button', { name: /Alex Wood/ }).tap()
  return sheet
}

test('picking and moving a player works with local feedback when vibration is absent', async ({ page }) => {
  const sheet = await openEditor(page)
  await expect(sheet.getByRole('meter', { name: 'Starting XI picked' })).toHaveAttribute('aria-valuenow', '1')
  expect(await page.evaluate(() => window.feedbackTarget)).toBe('GK, pick a player')
  await sheet.getByRole('button', { name: 'GK, Alex Wood' }).tap()
  await sheet.getByRole('button', { name: 'Move to bench' }).tap()
  await expect(sheet.getByRole('button', { name: 'Remove Alex Wood from the bench' })).toBeVisible()
  await expect(sheet.getByRole('meter')).toHaveAttribute('aria-valuenow', '0')
  await sheet.getByRole('button', { name: 'RB, pick a player' }).tap()
  await sheet.getByRole('group', { name: 'Pick a player' }).getByRole('button', { name: /Alex Wood.*On the bench/ }).tap()
  await expect(sheet.getByRole('button', { name: 'RB, Alex Wood' })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Remove Alex Wood from the bench' })).toHaveCount(0)
})

test('swiping or cancelling a touch on a picked shirt leaves the XI intact', async ({ page, browserName }) => {
  const sheet = await openEditor(page)
  const keeper = sheet.getByRole('button', { name: 'GK, Alex Wood' })
  await keeper.evaluate(el => el.scrollIntoView({ block: 'center' }))
  const before = await sheet.evaluate(el => el.scrollTop)
  const centre = await keeper.evaluate(el => {
    const { x, y, width, height } = el.getBoundingClientRect()
    return { x: x + width / 2, y: y + height / 2 }
  })
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [centre] })
    for (let dy = 16; dy <= 112; dy += 16) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: centre.x, y: centre.y + dy }] })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect.poll(() => sheet.evaluate(el => el.scrollTop)).toBeLessThan(before)
  } else {
    // Playwright's WebKit touchscreen exposes taps. Exercise Safari's pointer
    // cancellation path explicitly rather than substituting a mouse drag.
    const touch = { isPrimary: true, pointerType: 'touch', pointerId: 1, clientX: centre.x, clientY: centre.y }
    await keeper.dispatchEvent('pointerdown', touch)
    await keeper.dispatchEvent('pointermove', { ...touch, clientY: centre.y - 32 })
    await keeper.dispatchEvent('pointercancel', touch)
    await keeper.dispatchEvent('click', { detail: 1 })
  }
  await expect(keeper).toHaveCount(1)
  await expect(sheet.getByRole('group', { name: 'Pick a player' })).toHaveCount(0)
})
