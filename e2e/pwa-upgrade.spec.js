import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { auditRows } from './mobileAuditData.js'
import { seedStubSession } from './stubSupabase.js'

const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain',
}

// Two independently compiled releases, with different app/route hashes. Only
// one release is available on the origin at a time, exactly as on Pages.
async function buildRelease(dir, sha, api) {
  await promisify(execFile)(process.execPath, [
    resolve('node_modules/vite/bin/vite.js'), 'build', '--outDir', dir,
  ], { env: { ...process.env, CF_PAGES_COMMIT_SHA: sha, VITE_SUPABASE_URL: api, VITE_SUPABASE_ANON_KEY: 'stub' } })
}

test('an installed PWA keeps the current release until the player refreshes', async ({ page, context }) => {
  test.setTimeout(120_000)
  const dir = await mkdtemp(join(tmpdir(), 'mvf-upgrade-'))
  const previous = process.env.MVF_PWA_PREVIOUS_DIST
  const next = process.env.MVF_PWA_NEXT_DIST
  const releases = { a: previous || join(dir, 'a'), b: next || join(dir, 'b') }
  let release = 'a'
  let offline = false
  const rowsFor = auditRows('manager')
  const host = createServer(async (req, res) => {
    // A real worker can own fetches which Playwright's page.route cannot
    // intercept on WebKit. Serve the fictional profile on loopback too.
    const { pathname, searchParams } = new URL(req.url, 'http://localhost')
    if (pathname.startsWith('/rest/v1/')) {
      const rows = rowsFor(pathname.slice('/rest/v1/'.length), searchParams, [])
      const result = req.headers.accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result))
      return
    }
    if (offline) { res.writeHead(503).end(); return }
    const file = extname(pathname) ? pathname.slice(1) : 'index.html'
    try {
      const body = await readFile(join(releases[release], file))
      res.writeHead(200, { 'Content-Type': types[extname(file)], 'Cache-Control': 'no-store' }).end(body)
    } catch { res.writeHead(404).end() }
  })
  try {
    await new Promise(resolveListen => host.listen(0, '127.0.0.1', resolveListen))
    const url = 'http://127.0.0.1:' + host.address().port
    if (!previous) await buildRelease(releases.a, 'aaaaaaa', url)
    if (!next) await buildRelease(releases.b, 'bbbbbbb', url)
    const entries = await Promise.all(Object.values(releases).map(async root => {
      const html = await readFile(join(root, 'index.html'), 'utf8')
      return html.match(/<script type="module"[^>]+src="([^"]+)"/)[1]
    }))
    const [first, second] = entries
    expect(first).not.toEqual(second)
    await context.addInitScript(() => {
      sessionStorage.setItem('test:boots', String(Number(sessionStorage.getItem('test:boots')) + 1))
    })
    const script = tab => tab.locator('script[type="module"][src]').first()
    const boots = tab => tab.evaluate(() => sessionStorage.getItem('test:boots'))

    await page.goto(url)
    await page.getByLabel('Email').fill('unsaved@example.test')
    await page.evaluate(() => navigator.serviceWorker.ready)
    // A browser can install without claiming the first loaded document.
    if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
      await page.reload()
      await page.getByLabel('Email').fill('unsaved@example.test')
    }
    await expect(script(page)).toHaveAttribute('src', first)
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeHidden()
    const initialBoots = await boots(page)
    release = 'b'
    await page.evaluate(async () => (await navigator.serviceWorker.ready).update())
    const refresh = page.getByRole('button', { name: 'Refresh', exact: true })
    await expect(refresh).toBeVisible()
    expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).waiting?.state)).toBe('installed')
    await expect(page.getByLabel('Email')).toHaveValue('unsaved@example.test')
    expect(await boots(page)).toBe(initialBoots)

    // The archived production client predates per-tab acceptance. Exercise
    // the real installed client's own controls when rehearsing that migration.
    if (previous) {
      await refresh.click()
      await expect(script(page)).toHaveAttribute('src', second)
      await expect(page.getByLabel('Email')).toBeVisible()
      await expect(refresh).toBeHidden()
      expect(Number(await boots(page))).toBe(Number(initialBoots) + 1)
      return
    }

    // Cold-open the installed A shell while B is waiting. With all origin
    // files unavailable, open a never-visited code-split manager screen.
    offline = true
    const manager = await context.newPage()
    await seedStubSession(manager, url)
    await manager.addInitScript(() => localStorage.setItem('mvf:managerView', '1'))
    await manager.goto(url + '/fixtures')
    await expect(script(manager)).toHaveAttribute('src', first)
    await expect(manager.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible()
    await manager.getByRole('link', { name: 'Manage', exact: true }).click({ timeout: 8000 })
    await expect(manager.getByRole('heading', { name: 'Club admin' })).toBeVisible()
    const managerBoots = await boots(manager)
    offline = false

    await page.bringToFront()
    await refresh.click()
    await expect(script(page)).toHaveAttribute('src', second)
    await expect(refresh).toBeHidden()
    expect(Number(await boots(page))).toBe(Number(initialBoots) + 1)
    await manager.bringToFront()
    await expect(manager.getByRole('heading', { name: 'Club admin' })).toBeVisible()
    expect(await boots(manager)).toBe(managerBoots)
    offline = true
    await manager.getByRole('link', { name: 'Diagnostics' }).click()
    await expect(manager.getByRole('heading', { name: 'App errors' })).toBeVisible()
    expect(await boots(manager)).toBe(managerBoots)
    offline = false
    await manager.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(script(manager)).toHaveAttribute('src', second)
    await expect(manager.getByRole('heading', { name: 'App errors' })).toBeVisible()
    expect(Number(await boots(manager))).toBe(Number(managerBoots) + 1)
  } finally {
    host.closeAllConnections()
    if (host.listening) await new Promise(done => host.close(done))
    await rm(dir, { recursive: true, force: true })
  }
})
