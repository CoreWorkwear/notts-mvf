import { expect, test } from '@playwright/test'
import { loadEnv } from 'vite'
import { signInAsAuditMember } from './mobileAuditData.js'

const origin = loadEnv('production', process.cwd(), 'VITE_').VITE_SUPABASE_URL
test.use({ serviceWorkers: 'block', contextOptions: { reducedMotion: 'no-preference' } })

test('Results paints a score-shaped loading state on its first route frame', async ({ page }) => {
  await signInAsAuditMember(page, 'player', origin)
  await page.goto('/fixtures')
  await expect(page.getByRole('heading', { name: 'Upcoming' })).toBeVisible()
  let release
  const gate = new Promise(resolve => { release = resolve })
  await page.route('**/rest/v1/fixtures?**', async route => { await gate; await route.fallback() })

  // Sample actual frames from before the tap through the entrance. The
  // response stays parked so a quick fixture stub cannot mask a blank frame.
  await page.evaluate(() => {
    window.routeFrames = []
    function sample() {
      if (location.pathname === '/results') {
        const outlet = document.querySelector('main')
        const loading = outlet.querySelector('[data-skeleton="score"]')
        const surface = loading?.firstElementChild
        window.routeFrames.push({
          routes: outlet.querySelectorAll('.route-frame').length,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          painted: !!surface && surface.getBoundingClientRect().height >= 120 &&
            Number(getComputedStyle(loading).opacity) > .8 && Number(getComputedStyle(surface).opacity) > .8,
        })
      }
      if (window.routeFrames.length < 18) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  try {
    await page.getByRole('link', { name: 'Results', exact: true }).tap()
    await page.waitForFunction(() => window.routeFrames.length === 18)
    const frames = await page.evaluate(() => window.routeFrames)
    expect(frames.every(f => f.painted && f.routes === 1 && f.overflow === 0)).toBe(true)
    await expect(page.locator('#root')).toHaveCSS('overflow-x', 'clip')
  } finally { release() }
  await expect(page.getByRole('button', { name: /match centre/i })).toBeVisible()
  await expect(page.locator('.route-frame')).toHaveCSS('will-change', 'auto')
})

test('scrolling a long sheet keeps the page in place and Back restores its opener', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 375, height: 560 })
  await signInAsAuditMember(page, 'player', origin)
  await page.goto('/you')
  await page.addStyleTag({ content: ':root { --safe-t: 24px }' })
  await expect(page.getByText('+447700900123')).toBeVisible()
  const opener = page.getByRole('button', { name: 'Edit your details' })
  await opener.evaluate(el => {
    el.scrollIntoView({ block: 'center' })
    // Measure the actual tap after the browser's actionability scroll.
    el.addEventListener('pointerdown', () => { window.openerScroll = window.scrollY }, { once: true })
  })
  const scroll = () => page.evaluate(() => window.scrollY)
  await opener.tap()
  const previous = await page.evaluate(() => window.openerScroll)
  const dialog = page.getByRole('dialog')
  expect(await dialog.evaluate(el => el.closest('.route-frame') === null)).toBe(true)
  await expect(dialog).toHaveCSS('transform', 'none')
  const box = await dialog.boundingBox()
  const x = box.x + 16
  const y = box.y + box.height * .7
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let dy = 16; dy <= 144; dy += 16) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - dy }] })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await cdp.detach()
  } else {
    // Mobile WebKit exposes native taps through Playwright. Reproduce its
    // touch-pointer cancellation when the scrollport takes over, then drive
    // the actual WebKit scrollport with a page key.
    const touch = { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y }
    const form = dialog.locator('form')
    await form.dispatchEvent('pointerdown', touch)
    await form.dispatchEvent('pointermove', { ...touch, clientY: y - 90 })
    await form.dispatchEvent('pointercancel', touch)
    await page.locator('.sheet-backdrop').dispatchEvent('click', { detail: 1 })
    await dialog.press('PageDown')
  }
  await expect.poll(() => dialog.evaluate(el => el.scrollTop)).toBeGreaterThan(50)
  await dialog.press('Home')
  await expect.poll(() => dialog.evaluate(el => el.scrollTop)).toBe(0)

  // A pull that started inside the sheet can end on its backdrop. The
  // resulting click belongs to the backdrop only when the press started there.
  await page.mouse.move(x, box.y + 90)
  await page.mouse.down()
  await page.mouse.move(x, box.y - 8, { steps: 10 })
  await page.mouse.up()
  await expect(dialog).toBeVisible()
  expect(await scroll()).toBe(previous)
  await page.goBack()
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()
  expect(await scroll()).toBe(previous)
})
