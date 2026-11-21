import { chromium, devices } from 'playwright'
import { signInAsStubPlayer, ID } from '../e2e/stubSupabase.js'
import { auditOrigin } from '../e2e/mobileAuditData.js'

const base = new URL(process.argv[2])
if (!['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('Use a local stub build.')
const fixtures = Array.from({ length: 48 }, (_, i) => ({
  id: 'perf-' + i, team_id: ID.team, season_id: ID.season, home_away: 'Home',
  match_date: new Date(Date.now() + (i + 1) * 86400000).toISOString().slice(0, 10),
  kickoff: '10:30', fixture_type: 'Friendly', status: 'scheduled',
  team: { id: ID.team, label: 'Community', key: 'community' },
  opponent: { name: 'Sunday XI ' + (i + 1) }, venue: 'Club pitch', availability: [], results: [],
}))

const browser = await chromium.launch()
try {
  const context = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 800 },
    permissions: ['notifications'], serviceWorkers: 'block', reducedMotion: 'no-preference' })
  const page = await context.newPage()
  await signInAsStubPlayer(page, { origin: auditOrigin,
    getRows: (table, params, rows) => table === 'fixtures' ? fixtures : rows })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await page.goto(new URL('/fixtures', base).href)
  await page.getByText('Sunday XI 1', { exact: true }).first().waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(1200)
  const metrics = await page.evaluate(() => new Promise(resolve => {
    const intervals = []
    let start, last
    const distance = Math.min(5600, document.documentElement.scrollHeight - innerHeight)
    function frame(now) {
      if (start === undefined) start = now
      if (last !== undefined) intervals.push(now - last)
      last = now
      const progress = Math.min(1, (now - start) / 4500)
      window.scrollTo({ top: Math.round(progress * distance), behavior: 'instant' })
      if (progress < 1) requestAnimationFrame(frame)
      else {
        intervals.sort((a, b) => a - b)
        resolve({ travelled: scrollY, frames: intervals.length, fps: +(1000 * intervals.length / (now - start)).toFixed(1),
          p95FrameMs: +intervals[Math.floor(intervals.length * .95)].toFixed(1),
          over33ms: intervals.filter(x => x > 33.4).length })
      }
    }
    requestAnimationFrame(frame)
  }))
  if (metrics.travelled < 1000) throw new Error('Insufficient visible fixture rows for a scroll profile')
  console.log(JSON.stringify({ engine: browser.version(), viewport: '360x800', throttle: '4x', rows: fixtures.length, ...metrics }))
} finally { await browser.close() }
