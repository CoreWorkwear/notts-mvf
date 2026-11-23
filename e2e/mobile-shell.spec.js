import { expect, test } from '@playwright/test'
import { ID, signInAsStubPlayer, STUB } from './stubSupabase.js'
import { signInAsAuditMember } from './mobileAuditData.js'
import { loadEnv } from 'vite'

test.use({ serviceWorkers: 'block', viewport: { width: 280, height: 653 } })

test('club header stays reachable beyond the first screen of a long fixture diary', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const fixtures = Array.from({ length: 16 }, (_, i) => ({
    id: 'scroll-' + i, team_id: ID.team, team: { key: 'community', label: 'Community' },
    opponent: { name: 'Sunday XI ' + i }, match_date: '2099-05-01', kickoff: '10:00',
    home_away: 'Home', fixture_type: 'Friendly', availability: [], results: [],
  }))
  await signInAsStubPlayer(page, { getRows: (table, params, rows) => table === 'fixtures' ? fixtures : rows })
  await page.goto('/fixtures')
  await expect(page.getByRole('heading', { name: 'Sunday XI 0' })).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 1800))
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(1000)
  await expect(page.getByRole('combobox', { name: 'Season' })).toBeInViewport({ ratio: 1 })
})

test('a folded phone with large type keeps season, tabs and the open form usable', async ({ page }) => {
  await signInAsStubPlayer(page)
  await page.goto('/you')
  await expect(page.getByText(STUB.phone)).toBeVisible()
  await page.addStyleTag({ content: 'html:root { font-size: 200% !important; --safe-l: 12px; --safe-r: 18px; --safe-b: 20px; }' })
  const season = page.getByRole('combobox', { name: 'Season' })
  expect((await season.boundingBox()).width).toBeGreaterThan(100)
  const nav = page.getByRole('navigation', { name: 'Club navigation' })
  await expect(nav.getByRole('link', { name: 'You' })).toBeInViewport({ ratio: 1 })
  const rail = await nav.boundingBox()
  expect(rail.x).toBeGreaterThanOrEqual(12)
  expect(rail.x + rail.width).toBeLessThanOrEqual(280 - 18)
  await expect(nav.getByText('Fixtures')).toHaveCSS('white-space', 'nowrap')
  const opener = page.getByRole('button', { name: 'Edit your details' })
  await opener.tap()
  const editor = page.getByRole('dialog', { name: 'Edit your details' })
  const save = editor.getByRole('button', { name: 'Save changes' })
  await expect(save).toBeInViewport({ ratio: 1 })
  const bounds = await save.boundingBox()
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(653 - 20)
  await page.keyboard.press('Escape')
  await expect(opener).toBeFocused()
})

test('the header shows the complete wordmark only when it fits', async ({ page }) => {
  await signInAsStubPlayer(page)
  await page.setViewportSize({ width: 393, height: 852 })
  await page.goto('/you')
  await expect(page.getByText(STUB.phone)).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const fits = () => page.locator('.wordmark').evaluate(el => {
    const text = el.firstElementChild ?? el
    if (getComputedStyle(text).visibility === 'hidden') return true
    const glyphs = document.createRange()
    glyphs.selectNodeContents(text)
    const ink = glyphs.getBoundingClientRect()
    const space = el.getBoundingClientRect()
    return ink.left >= space.left && ink.right <= space.right
  })
  // WebKit applies size container queries on the next layout after font load
  // or viewport change. Check the settled text bounds, including the narrow
  // range where the old 5.8em threshold cut the last two pixels off.
  await expect.poll(fits).toBe(true)
  await page.setViewportSize({ width: 431, height: 852 })
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
  await expect.poll(fits).toBe(true)
  await page.setViewportSize({ width: 744, height: 1133 })
  await expect(page.getByText('Notts MvF', { exact: true })).toBeVisible()
  await expect.poll(fits).toBe(true)
})

test('the line-up editor keeps Save reachable at both ends of a short landscape sheet', async ({ page }) => {
  const origin = loadEnv('production', process.cwd(), 'VITE_').VITE_SUPABASE_URL
  await signInAsAuditMember(page, 'manager', origin)
  await page.setViewportSize({ width: 667, height: 375 })
  await page.goto('/fixtures')
  await page.addStyleTag({ content: 'html:root { font-size: 200% !important; --safe-l: 32px; --safe-r: 32px; --safe-b: 20px; }' })
  await page.getByRole('button', { name: 'Line-up', exact: true }).click()
  await page.getByRole('button', { name: 'Pick the line-up' }).click()
  const editor = page.getByRole('dialog')
  const save = editor.getByRole('button', { name: 'Save line-up' })
  for (const end of ['start', 'end']) {
    await editor.evaluate((el, at) => { el.scrollTop = at === 'start' ? 0 : el.scrollHeight }, end)
    await expect(save).toBeInViewport({ ratio: 1 })
    const bounds = await save.boundingBox()
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(355)
  }
})

test('Log result clears the home indicator before scrolling a short landscape form', async ({ page }) => {
  const origin = loadEnv('production', process.cwd(), 'VITE_').VITE_SUPABASE_URL
  await signInAsAuditMember(page, 'manager', origin)
  await page.setViewportSize({ width: 653, height: 280 })
  await page.goto('/results')
  await page.addStyleTag({ content: 'html:root { font-size: 200% !important; --safe-l: 32px; --safe-r: 32px; --safe-b: 20px; }' })
  await page.getByRole('button', { name: /West Bridgford United/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.evaluate(el => { el.scrollTop = 0 })
  const bounds = await dialog.getByRole('button', { name: 'Log result', exact: true }).boundingBox()
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(260)
})

test('native fixture pickers stay inside the sheet after rotating with enlarged text', async ({ page }) => {
  const origin = loadEnv('production', process.cwd(), 'VITE_').VITE_SUPABASE_URL
  await signInAsAuditMember(page, 'manager', origin)
  await page.setViewportSize({ width: 800, height: 360 })
  await page.goto('/fixtures')
  await page.addStyleTag({ content: 'html:root { font-size:32px !important; --safe-l:24px; --safe-r:24px; --safe-t:0px; --safe-b:20px; }' })
  await page.getByRole('button', { name: 'Add a fixture' }).click()
  const dialog = page.getByRole('dialog')
  const competition = dialog.getByRole('combobox', { name: 'Competition' })
  await expect(competition).toHaveCSS('font-size', '32px')
  await page.evaluate(() => document.fonts.ready)
  await page.setViewportSize({ width: 280, height: 653 })
  await page.addStyleTag({ content: 'html:root { --safe-l:0px; --safe-r:0px; --safe-t:24px; --safe-b:24px; }' })
  await competition.selectOption({ label: 'County Sunday League' })
  await expect(competition).toHaveValue('comp-one')
  await expect.poll(() => dialog.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
})
