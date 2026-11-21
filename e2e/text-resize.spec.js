import { test, expect } from '@playwright/test'
import { ID, signInAsStubPlayer } from './stubSupabase.js'

test.use({ serviceWorkers: 'block' })

test('result text follows the reader’s setting after rotating and changing text size', async ({ page }) => {
  await signInAsStubPlayer(page, { getRows(table, params, rows) {
    if (table === 'profiles') return rows.map(p => ({ ...p, role: 'admin' }))
    if (table !== 'fixtures') return rows
    if (params.get('select')?.includes('results!inner')) return []
    return [{ id: 'fixture', season_id: ID.season, match_date: '2020-04-01', kickoff: '10:30',
      status: 'scheduled', team_id: ID.team, team: { label: 'Community' }, home_away: 'Away',
      opponent: { name: 'West Bridgford United' }, results: [] }]
  } })
  await page.addInitScript(() => localStorage.setItem('mvf:managerView', '1'))
  await page.goto('/results')
  const match = page.locator('.needs-row .grow')
  await expect(match).toBeVisible()
  for (const [width, height, size] of [[375, 667, 16], [375, 667, 24], [375, 667, 32], [667, 375, 16], [667, 375, 24], [667, 375, 32], [393, 852, 16]]) {
    await page.setViewportSize({ width, height })
    await page.evaluate(async px => {
      document.documentElement.style.setProperty('font-size', px + 'px', 'important')
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    }, size)
  }
  // Allow WebKit to propagate a changed reader preference through the tree.
  // The date and action must never squeeze a long opponent into a thin column.
  await expect(match).toHaveCSS('font-size', '16px')
  const row = page.locator('.needs-row')
  const room = await row.evaluate(el => el.clientWidth - parseFloat(getComputedStyle(el).paddingInlineStart)
    - parseFloat(getComputedStyle(el).paddingInlineEnd))
  expect((await match.boundingBox()).width).toBeGreaterThanOrEqual(room - 1)
})
