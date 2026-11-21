import { test, expect } from '@playwright/test'
import { loadEnv } from 'vite'
import sharp from 'sharp'
import { signInAsAuditMember } from './mobileAuditData.js'

test.use({ serviceWorkers: 'block' })

test('club photo uploads advertise only renditions that Storage accepted', async ({ page }) => {
  const origin = loadEnv('production', process.cwd(), 'VITE_').VITE_SUPABASE_URL
  await signInAsAuditMember(page, 'manager', origin)
  const writes = []
  const rows = []
  let rejectThumb = false
  const headers = { 'access-control-allow-origin': '*' }
  // Register after the main fake so this test intercepts these specific writes.
  await page.route(origin + '/storage/v1/object/media/photos/**', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    const url = new URL(route.request().url())
    writes.push(url.pathname)
    return route.fulfill({ status: rejectThumb && /-thumb\./.test(url.pathname) ? 403 : 200, headers, json: {} })
  })
  await page.route(origin + '/rest/v1/media_assets*', async route => {
    if (route.request().method() === 'OPTIONS') return route.fallback()
    if (route.request().method() === 'POST') {
      rows.push(route.request().postDataJSON())
      return route.fulfill({ status: 201, headers, body: '' })
    }
    return route.fulfill({ headers, json: rows.map((row, index) => ({ ...row, id: 'photo-' + index })) })
  })
  await page.goto('/media')
  const input = page.locator('input[type=file][multiple]')
  const source = { name: 'club.png', mimeType: 'image/png', buffer: await sharp({
    create: { width: 640, height: 400, channels: 4, background: '#063522' },
  }).png().toBuffer() }
  await input.setInputFiles(source)
  const thumb = page.locator('.photo-open img').first()
  await expect(thumb).toHaveAttribute('srcset', /-thumb\.(?:webp|png) 256w, .* 640w$/)
  expect(rows[0].url).toMatch(/#mvf=256,640$/)
  expect(writes).toHaveLength(2)
  rejectThumb = true
  await input.setInputFiles(source)
  await expect(page.locator('.photo-open img')).toHaveCount(2)
  expect(rows[1].url).not.toContain('#mvf=')
  await expect(page.locator('.photo-open img').nth(1)).not.toHaveAttribute('srcset', /./)
})
