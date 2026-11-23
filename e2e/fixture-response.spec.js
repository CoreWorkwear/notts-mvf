import { expect, test } from '@playwright/test'
import { loadEnv } from 'vite'
import { signInAsAuditMember } from './mobileAuditData.js'

test.use({ serviceWorkers: 'block', contextOptions: { reducedMotion: 'no-preference' } })

test('hero and match details share a pending answer, its confirmation and a failed change', async ({ page }) => {
  const origin = loadEnv('production', process.cwd(), 'VITE_').VITE_SUPABASE_URL
  await signInAsAuditMember(page, 'player', origin)
  let finishWrite
  const waitForSave = new Promise(resolve => { finishWrite = resolve })
  let fail = false
  await page.route('**/rest/v1/availability?*', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    if (fail) return route.abort('failed')
    await waitForSave
    return route.fallback()
  })

  await page.goto('/fixtures')
  const hero = page.locator('.hero')
  const heroIn = hero.getByRole('button', { name: "I'm in" })
  await heroIn.tap()
  await expect(heroIn).toHaveAttribute('aria-pressed', 'true')
  await expect(hero.getByRole('status')).toHaveText('Saving…')
  await hero.getByRole('button', { name: /match details/i }).tap()
  const sheet = page.getByRole('dialog')
  const sheetIn = sheet.getByRole('button', { name: "I'm in" })
  await expect(sheetIn).toBeDisabled()
  await expect(sheetIn).toHaveAttribute('aria-pressed', 'true')
  finishWrite()
  await expect(sheetIn).toBeEnabled()
  await expect(sheet.getByRole('status')).toHaveText('Confirmed')

  fail = true
  await sheet.getByRole('button', { name: 'Maybe' }).tap()
  await expect(sheet.getByRole('status')).toHaveText('Not saved')
  await expect(sheetIn).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await expect(heroIn).toHaveAttribute('aria-pressed', 'true')
})
