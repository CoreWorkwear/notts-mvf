import { expect, test } from '@playwright/test'
import { loadEnv } from 'vite'
import { signInAsAuditMember } from './mobileAuditData.js'

const origin = loadEnv('production', process.cwd(), 'VITE_').VITE_SUPABASE_URL
test.use({ serviceWorkers: 'block' })

test('a player can browse the rankings, change team and read a match report', async ({ page }) => {
  await signInAsAuditMember(page, 'player', origin)
  await page.goto('/club')
  await page.getByRole('tab', { name: 'Stats', exact: true }).click()
  const rankings = page.getByRole('region', { name: 'Player leaderboards' })
  await rankings.focus()
  await page.keyboard.press('End')
  await expect.poll(() => rankings.evaluate(el => el.scrollLeft + el.clientWidth >= el.scrollWidth - 2)).toBe(true)
  await page.getByRole('tab', { name: 'Community' }).click()
  await expect(page.getByText('No stats yet')).toBeVisible()
  await page.getByRole('tab', { name: '1st Team' }).click()
  await page.getByLabel('Sort squad by').selectOption('assists')
  const squad = page.getByRole('list', { name: 'Squad statistics' })
  await expect(squad.getByRole('listitem').first().getByRole('heading')).toHaveText('Robin Clarke')

  await page.getByRole('link', { name: 'Results', exact: true }).click()
  await page.getByRole('button', { name: /match centre/i }).click()
  const report = page.getByRole('dialog', { name: /match report/i })
  await expect(report.getByRole('list', { name: 'Goal timeline' })).toContainText('67′')
  await expect(report.getByRole('heading', { name: 'Line-up' })).toBeVisible()
})
