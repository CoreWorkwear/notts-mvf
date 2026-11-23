import { expect, test } from '@playwright/test'
import { loadEnv } from 'vite'
import sharp from 'sharp'
import { signInAsAuditMember } from './mobileAuditData.js'

const origin = loadEnv('production', process.cwd(), 'VITE_').VITE_SUPABASE_URL
test.use({ serviceWorkers: 'block' })

function luminance(rgb) {
  const [r, g, b] = rgb.map(value => value / 255).map(value =>
    value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  return .2126 * r + .7152 * g + .0722 * b
}

// axe cannot resolve a photograph through the poster gradient. Use a white
// image as the brightest possible original; sample the actual painted wash.
async function contrast(label) {
  await expect(label).toBeVisible()
  await expect.poll(() => label.evaluate(el => {
    let poster = el.closest('.hero, .result-hero')
    while (poster) {
      if (Number(getComputedStyle(poster).opacity) < .99) return false
      poster = poster.parentElement
    }
    return true
  })).toBe(true)
  await label.evaluate(el => {
    el.style.setProperty('-webkit-text-fill-color', 'transparent')
  })
  async function centrePixel() {
    const image = await label.screenshot({ scale: 'css' })
    const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const centre = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels
    return [...data.subarray(centre, centre + 3)]
  }
  const background = await centrePixel()
  // Paint with the label's current colour in its original compositing group.
  // Sampling the result includes opacity on the team label and its ancestors.
  await label.evaluate(el => {
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative'
    const probe = document.createElement('span')
    Object.assign(probe.style, { position: 'absolute', inset: '0', background: 'currentColor' })
    el.append(probe)
  })
  const foreground = await centrePixel()
  const [bright, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (bright + .05) / (dark + .05)
}

for (const theme of ['light', 'dark']) {
  test('player response and team labels remain readable on the ' + theme + ' poster', async ({ page }) => {
    await signInAsAuditMember(page, 'player', origin)
    await page.addInitScript(value => localStorage.setItem('theme', value), theme)
    await page.goto('/fixtures')
    const hero = page.locator('.hero')
    for (const selector of ['.av-saved', '.pill-first']) {
      expect(await contrast(hero.locator(selector)), selector).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('score labels on bright match photos meet AA in ' + theme, async ({ page }) => {
    await signInAsAuditMember(page, 'manager', origin)
    await page.addInitScript(value => localStorage.setItem('theme', value), theme)
    await page.goto('/results')
    const poster = page.locator('.result-hero')
    await expect(poster).toBeVisible()
    await poster.evaluate(el => { el.style.backgroundImage = 'var(--hero-wash), linear-gradient(white,white)' })
    for (const selector of ['.kicker', '.flash', '.bug-team']) {
      expect(await contrast(poster.locator(selector).first()), selector).toBeGreaterThanOrEqual(4.5)
    }
    await poster.click()
    const goals = page.getByRole('dialog').locator('.shirt-tag').first()
    expect(await contrast(goals), 'goals on the line-up').toBeGreaterThanOrEqual(4.5)
  })
}

test('poster team name stays legible when 200% text reflows a fold cover', async ({ page }) => {
  await signInAsAuditMember(page, 'player', origin)
  await page.setViewportSize({ width: 280, height: 653 })
  await page.goto('/fixtures')
  const hero = page.locator('.hero')
  await expect(hero.locator('.hero-team-name')).toBeVisible()
  await hero.evaluate(el => {
    document.documentElement.style.fontSize = '200%'
    el.querySelector('.hero-bg').style.backgroundImage = 'var(--hero-wash), linear-gradient(white,white)'
  })
  expect(await contrast(hero.locator('.hero-team-name'))).toBeGreaterThanOrEqual(4.5)
})
