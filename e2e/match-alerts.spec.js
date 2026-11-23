import { expect, test } from '@playwright/test'
import { loadEnv } from 'vite'
import { signInAsAuditMember } from './mobileAuditData.js'

const env = loadEnv('production', process.cwd(), 'VITE_')
const fixtureId = '10000000-0000-4000-8000-000000000001'
test.use({ serviceWorkers: 'block' })

async function prepare(page, { permission = 'default', homeScreen = true } = {}) {
  await signInAsAuditMember(page, 'player', env.VITE_SUPABASE_URL)
  await page.addInitScript(({ permission, homeScreen }) => {
    const record = { asked: 0, subscribed: 0, userVisibleOnly: null }
    window.alertCalls = record
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: homeScreen })
    if (!homeScreen) Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'iPhone Safari' })
    Object.defineProperty(window, 'Notification', { configurable: true, value: {
      permission, requestPermission() {
        record.asked++
        this.permission = 'granted'
        return Promise.resolve(this.permission)
      },
    } })
    Object.defineProperty(window, 'PushManager', { configurable: true, value: class {} })
    let subscription = null
    const pushManager = {
      getSubscription: async () => subscription,
      subscribe: async options => {
        record.subscribed++
        record.userVisibleOnly = options.userVisibleOnly
        subscription = { endpoint: 'https://example.invalid/mock-push' }
        return subscription
      },
    }
    Object.defineProperty(navigator.serviceWorker, 'ready', { configurable: true, value: Promise.resolve({ pushManager }) })
  }, { permission, homeScreen })
}

for (const permission of ['default', 'granted']) {
  test(permission + ' permission starts with the benefits sheet and uses the native request only when needed', async ({ page }) => {
    await prepare(page, { permission })
    await page.goto(permission === 'default' ? '/fixtures' : '/you')
    if (permission === 'default') {
      await page.locator('.hero').getByRole('button', { name: "I'm in" }).tap()
      await page.getByRole('region', { name: 'Turn on notifications' }).getByRole('button', { name: 'Turn on' }).tap()
    } else {
      await page.getByRole('button', { name: 'Match alerts' }).tap()
    }
    const sheet = page.getByRole('dialog', { name: 'Match alerts' })
    await expect(sheet.getByText(/as soon as it's named/)).toBeVisible()
    expect(await page.evaluate(() => window.alertCalls.asked)).toBe(0)
    await sheet.getByRole('button', { name: 'Enable match alerts' }).tap()
    if (!env.VITE_VAPID_PUBLIC_KEY) {
      await expect(sheet.getByRole('alert')).toHaveText('Match alerts are unavailable.')
      expect(await page.evaluate(() => window.alertCalls.subscribed)).toBe(0)
      return
    }
    await expect(sheet).toBeHidden()
    expect(await page.evaluate(() => window.alertCalls)).toEqual({
      asked: permission === 'default' ? 1 : 0, subscribed: 1, userVisibleOnly: true,
    })
  })
}

test('blocked alerts give settings instructions without another native prompt', async ({ page }) => {
  await prepare(page, { permission: 'denied' })
  await page.goto('/you')
  await page.getByRole('button', { name: 'Match alerts' }).tap()
  const sheet = page.getByRole('dialog', { name: 'Match alerts' })
  await expect(sheet.getByText(/browser or device settings/i)).toBeVisible()
  await sheet.getByRole('button', { name: 'Got it' }).tap()
  expect(await page.evaluate(() => window.alertCalls.asked)).toBe(0)
})

test('Safari outside the Home Screen gets the two installation steps', async ({ page }) => {
  await prepare(page, { homeScreen: false })
  await page.goto('/you')
  const setup = page.getByRole('button', { name: 'Set up match alerts', exact: true })
  await expect(setup).not.toHaveAttribute('aria-pressed', /./)
  await setup.tap()
  const sheet = page.getByRole('dialog', { name: 'Match alerts' })
  await expect(sheet.getByRole('listitem')).toHaveCount(2)
  await expect(sheet.getByText('Add to Home Screen', { exact: true })).toBeVisible()
  await expect(sheet.getByText(/from your Home Screen/)).toBeVisible()
  expect(await page.evaluate(() => window.alertCalls.asked)).toBe(0)
})

test('a foreground line-up can be swiped away or opened on the addressed fixture', async ({ page }) => {
  await prepare(page)
  await page.goto('/you')
  await expect(page.getByRole('button', { name: 'Edit your details' })).toBeVisible()
  const deliver = () => page.evaluate(id => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', {
    data: { type: 'mvf-foreground', kind: 'lineup', teamKey: 'xl', title: 'The line-up is in', body: 'Your squad has been named.',
      url: '/fixtures?mvf_fixture=' + id + '&view=lineup' },
  })), fixtureId)
  const pill = page.getByRole('complementary', { name: 'Match notification' })
  await deliver()
  await expect(pill).toBeVisible()
  const b = await pill.boundingBox()
  const x = b.x + b.width / 2
  await page.mouse.move(x, b.y + b.height - 10)
  await page.mouse.down()
  await page.mouse.move(x, b.y + 3, { steps: 8 })
  await page.mouse.up()
  await expect(pill).toBeHidden()
  await expect(page).toHaveURL(/\/you$/)
  await deliver()
  await pill.getByRole('button', { name: /View line-up/i }).tap()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('heading', { name: 'Sherwood Athletic' })).toBeVisible()
  await expect(sheet.getByRole('tab', { name: 'Line-up' })).toHaveAttribute('aria-selected', 'true')
})
