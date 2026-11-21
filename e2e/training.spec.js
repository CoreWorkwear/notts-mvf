import { test, expect } from '@playwright/test'
import { signInAsStubPlayer, ID } from './stubSupabase'
import { todayISO, addDaysISO } from '../src/lib/format'

test.use({ serviceWorkers: 'block', viewport: { width: 384, height: 854 } })
const date = addDaysISO(todayISO(), 2)
const session = { id: '00000000-0000-4000-8000-00000000aa01', club_id: ID.club, start_date: date, start_time: '19:00:00', venue: 'Club pitch', town: 'Nottingham', audience: 'club', focus: 'Passing', cancelled: false, revision: 1, series_id: null }
const nextMonday = addDaysISO(date, (8 - new Date(date + 'T12:00:00Z').getUTCDay()) % 7)
const ground = { address: 'Meadow Lane', postcode: 'NG2 3HJ', w3w: '///pitch.club.gates', venue_lat: 52.941, venue_lng: -1.138 }

function fixture(createdDates) {
  const sessions = []
  const replies = {}
  const calls = []
  const notices = []
  return {
    sessions, replies, calls, notices,
    getRows(table, _params, fallback) {
      if (table === 'training_sessions') return sessions.map(s => ({ ...s, training_replies: replies[s.id] ? [{ profile_id: ID.player, status: replies[s.id] }] : [] }))
      if (table === 'training_notices') return notices
      return fallback
    },
    rpc(name, body) {
      calls.push({ name, body })
      if (name === 'create_training_series') {
        const rows = (createdDates || [body.p_date]).map((start_date, index) => ({
          ...session, start_date, id: session.id.slice(0, -2) + String(index + 1).padStart(2, '0'),
          series_id: body.p_frequency === 'once' ? null : '00000000-0000-4000-8000-00000000ff01',
          start_time: body.p_time, venue: body.p_venue, town: body.p_town, audience: body.p_audience, focus: body.p_focus,
          address: body.p_address, postcode: body.p_postcode, w3w: body.p_w3w, venue_lat: body.p_venue_lat, venue_lng: body.p_venue_lng,
        }))
        sessions.push(...rows)
        return rows[0].id
      }
      if (name === 'change_training_session_venue') {
        const occurrence = sessions.find(s => s.id === body.p_session_id)
        if (!body.p_cancel) Object.assign(occurrence, { start_date: body.p_date, start_time: body.p_time, venue: body.p_venue, town: body.p_town, focus: body.p_focus,
          address: body.p_address, postcode: body.p_postcode, w3w: body.p_w3w, venue_lat: body.p_venue_lat, venue_lng: body.p_venue_lng })
        occurrence.cancelled = body.p_cancel
        occurrence.revision++
        notices.unshift({ id: 'notice-' + notices.length, title: body.p_cancel ? 'Training cancelled' : 'Training moved', body: 'Training ' + (body.p_cancel ? 'cancelled' : 'now starts') + ' at ' + body.p_time.slice(0, 5) + ' on ' + body.p_date + '.', kind: body.p_cancel ? 'cancelled' : 'moved', session_id: occurrence.id, created_at: new Date().toISOString(), training_sessions: { ...occurrence } })
        return occurrence.revision
      }
      if (name === 'reply_to_training') { replies[body.p_session_id] = body.p_status; return null }
      if (name === 'training_headcount') return [{ profile_id: ID.player, first_name: 'Test', last_name: 'Player', status: replies[body.p_session_id] || null }, { profile_id: 'other', first_name: 'Sam', last_name: 'Jones', status: null }]
      return null
    },
  }
}
async function setup(page, state, manager = false) {
  if (manager) await page.addInitScript(() => localStorage.setItem('mvf:managerView', '1'))
  await page.route('https://api.postcodes.io/postcodes/**', route => route.fulfill({ json: { result: { latitude: ground.venue_lat, longitude: ground.venue_lng } } }))
  await page.route('https://api.open-meteo.com/v1/forecast?**', route => {
    const params = new URL(route.request().url()).searchParams
    expect([params.get('latitude'), params.get('longitude')]).toEqual([String(ground.venue_lat), String(ground.venue_lng)])
    const day = params.get('start_date')
    return route.fulfill({ json: { hourly: { time: [`${day}T19:00`], weather_code: [2], temperature_2m: [12],
      apparent_temperature: [10], precipitation_probability: [20], wind_speed_10m: [8] } } })
  })
  await signInAsStubPlayer(page, { getRows: state.getRows, rpc: state.rpc, profile: manager ? { role: 'admin' } : undefined })
}
async function openBooking(page, firstDate) {
  await page.getByRole('button', { name: 'Book training' }).click()
  const dialog = page.getByRole('dialog', { name: 'Book training' })
  await dialog.getByLabel('Date', { exact: true }).fill('')
  await dialog.getByLabel('Date', { exact: true }).fill(firstDate)
  await expect(dialog.getByLabel('Date', { exact: true })).toHaveValue(firstDate)
  await dialog.getByLabel('Local start time').fill('19:00')
  await dialog.getByLabel('Venue', { exact: true }).fill('Club pitch')
  await dialog.getByLabel('Town', { exact: true }).fill('Nottingham')
  await dialog.getByLabel('Address', { exact: true }).fill(ground.address)
  await dialog.getByLabel('Postcode', { exact: true }).fill('ng23hj')
  await dialog.getByLabel('what3words', { exact: true }).fill(ground.w3w)
  return dialog
}
async function publish(page, dialog) {
  await dialog.getByRole('button', { name: 'Publish training' }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('dialog', { name: 'Training session' }).getByRole('button', { name: 'Close', exact: true }).click()
}
async function captureGrounds(page, testInfo, name) {
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme })
    await expect(page.locator('html')).toHaveAttribute('data-ground', scheme)
    const capture = await page.screenshot({ path: `test-results/training-${name}-${testInfo.project.name}-${scheme}-384.png`, scale: 'css', animations: 'disabled' })
    expect([capture.readUInt32BE(16), capture.readUInt32BE(20)]).toEqual([384, 854])
  }
}

test('manager books one session; player answers; manager sees names and No reply', async ({ page, context }) => {
  const state = fixture()
  await setup(page, state, true)
  await page.goto('/training')
  await expect(page.getByRole('heading', { name: 'Training', exact: true })).toBeVisible()
  await publish(page, await openBooking(page, date))
  expect(state.calls.find(call => call.name === 'create_training_series').body).toMatchObject({
    p_frequency: 'once', p_interval: 1, p_count: 1, p_until: null, p_weekdays: [],
    p_address: ground.address, p_postcode: ground.postcode, p_w3w: ground.w3w, p_venue_lat: ground.venue_lat, p_venue_lng: ground.venue_lng,
  })
  const player = await context.newPage()
  await setup(player, state)
  // Each page has its own storage seed; explicit player mode in shared browser context.
  await player.addInitScript(() => localStorage.setItem('mvf:managerView', '0'))
  await player.goto('/training?session=' + session.id)
  const detail = player.getByRole('dialog', { name: 'Training session' })
  await expect(detail).toBeVisible()
  await detail.getByRole('button', { name: 'In', exact: true }).click()
  await expect(detail.getByRole('button', { name: 'In', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(state.replies[session.id]).toBe('in')
  await page.addInitScript(() => localStorage.setItem('mvf:managerView', '1'))
  await page.goto('/training?session=' + session.id)
  await expect(page.getByText('Test Player', { exact: true })).toBeVisible()
  await expect(page.getByText('Sam Jones', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'No reply 1' })).toBeVisible()
  await player.close()
})

test('fortnightly booking includes the final date; manager navigation fits 384px', async ({ page }, testInfo) => {
  const finalDate = addDaysISO(date, 28)
  const state = fixture([date, addDaysISO(date, 14), finalDate])
  await setup(page, state, true)
  await page.goto('/training')
  const dialog = await openBooking(page, date)
  await dialog.getByRole('checkbox', { name: 'Recurring' }).check()
  await dialog.getByLabel('Repeat every').fill('2')
  await dialog.getByRole('radio', { name: 'On date' }).check()
  await dialog.getByLabel('End date', { exact: true }).fill(finalDate)
  await expect(dialog.getByText(/Every 2 weeks/)).toContainText('3 sessions')
  await publish(page, dialog)
  expect(state.calls.find(call => call.name === 'create_training_series').body).toMatchObject({
    p_frequency: 'week', p_interval: 2, p_weekdays: [new Date(date + 'T12:00:00Z').getUTCDay() || 7], p_until: finalDate, p_count: null,
  })
  const nav = page.getByRole('navigation', { name: 'Club navigation' })
  // All labels stay available together, with no sideways document scroll.
  await expect(page.getByRole('link', { name: 'Training', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  if (await nav.count()) expect(await nav.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  const card = page.getByRole('article').filter({ hasText: ground.postcode })
  await expect(card.getByRole('link', { name: 'Get directions' })).toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&destination=52.941%2C-1.138')
  const forecast = card.getByRole('group', { name: /Training forecast, Partly cloudy at 19:00/i })
  await expect(forecast).toContainText('12°')
  await card.scrollIntoViewIfNeeded()
  await captureGrounds(page, testInfo, 'manager')
  await card.getByRole('button', { name: /Club pitch/ }).click()
  const venue = page.getByRole('region', { name: 'Training venue' })
  await expect(venue.getByRole('link', { name: 'Open in Maps' })).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=52.941%2C-1.138')
  await expect(venue.getByRole('link', { name: ground.w3w })).toHaveAttribute('href', 'https://what3words.com/pitch.club.gates')
  await expect(venue.getByRole('region', { name: 'Training forecast' })).toContainText('12°')
})

test('manager selects two weekdays and ends after four actual sessions', async ({ page }, testInfo) => {
  const dates = [0, 2, 14, 16].map(offset => addDaysISO(nextMonday, offset))
  const state = fixture(dates)
  await setup(page, state, true)
  await page.goto('/training')
  const dialog = await openBooking(page, nextMonday)
  await dialog.getByRole('checkbox', { name: 'Recurring' }).check()
  await dialog.getByLabel('Repeat every').fill('2')
  await expect(dialog.getByRole('checkbox', { name: 'Monday' })).toBeChecked()
  await dialog.getByRole('checkbox', { name: 'Wednesday' }).check()
  await dialog.getByRole('radio', { name: 'After', exact: true }).check()
  await dialog.getByLabel('Number of sessions').fill('4')
  await expect(dialog.getByText(/Every 2 weeks on Mon, Wed/)).toContainText('4 sessions')
  await dialog.getByLabel('Number of sessions').blur()
  await dialog.evaluate(el => el.scrollTo({ top: 0, behavior: 'instant' }))
  await captureGrounds(page, testInfo, 'recurrence')
  await publish(page, dialog)
  expect(state.calls.find(call => call.name === 'create_training_series').body).toMatchObject({
    p_date: nextMonday, p_frequency: 'week', p_interval: 2, p_weekdays: [1, 3], p_count: 4, p_until: null,
  })
  await expect(page.getByRole('article').filter({ hasText: ground.postcode })).toHaveCount(2)
})

test('same-page notice opens its exact session and keeps saved availability', async ({ page }, testInfo) => {
  const state = fixture()
  state.sessions.push({ ...session, ...ground })
  state.replies[session.id] = 'out'
  state.notices.push({ id: 'notice-1', title: 'Training moved', body: 'Training now starts at 19:00 on ' + date + '.', kind: 'moved', session_id: session.id, created_at: new Date().toISOString(), training_sessions: { ...session } })
  await setup(page, state)
  await page.goto('/training')
  const inbox = page.getByRole('region', { name: 'Training notices', exact: true })
  await inbox.getByRole('link', { name: 'Update your availability' }).click()
  const detail = page.getByRole('dialog', { name: 'Training session' })
  await expect(detail.getByRole('button', { name: 'Out', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await detail.getByRole('button', { name: 'Maybe', exact: true }).click()
  await expect(detail.getByRole('button', { name: 'Maybe', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await detail.getByRole('button', { name: 'Close', exact: true }).click()
  await inbox.getByRole('link', { name: 'Update your availability' }).click()
  await expect(detail).toBeVisible()
  await expect(detail.getByRole('region', { name: 'Training forecast' })).toContainText('12°')
  await captureGrounds(page, testInfo, 'player')
})


test('manager changes one occurrence then cancels deliberately, retaining recorded replies', async ({ page }) => {
  const state = fixture()
  state.sessions.push({ ...session })
  state.replies[session.id] = 'out'
  await setup(page, state, true)
  await page.goto('/training?session=' + session.id)
  await page.getByRole('button', { name: 'Edit session' }).click()
  const editor = page.getByRole('dialog', { name: 'Edit training' })
  await expect(editor).toBeVisible()
  await editor.getByLabel('Venue', { exact: true }).fill('New pitch')
  await editor.getByLabel('Local start time').fill('20:00')
  await editor.getByRole('button', { name: 'Save changes' }).click()
  const detail = page.getByRole('dialog', { name: 'Training session' })
  await expect(detail).toBeVisible()
  await expect(detail.getByText('New pitch, Nottingham')).toBeVisible()
  await expect(detail.getByRole('button', { name: 'Out', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(detail.getByRole('heading', { name: 'Out 1' })).toBeVisible()
  await detail.getByRole('button', { name: 'Cancel session' }).click()
  expect(state.sessions[0].cancelled).toBe(false)
  await detail.getByRole('button', { name: 'Keep session' }).click()
  await detail.getByRole('button', { name: 'Cancel session' }).click()
  await detail.getByRole('button', { name: 'Confirm cancellation' }).click()
  await expect(detail.getByRole('status').filter({ hasText: 'Cancelled' })).toContainText('Cancelled · Your reply: Out')
  expect(state.replies[session.id]).toBe('out')
  await expect(detail.getByRole('heading', { name: 'Out 1' })).toBeVisible()
  await expect(detail.getByRole('button', { name: 'In', exact: true })).toHaveCount(0)
  expect(state.notices.map(n => n.kind)).toEqual(['cancelled', 'moved'])
})

test('a newly arrived notice refreshes stale occurrence revision before player reply', async ({ page }) => {
  const state = fixture()
  state.sessions.push({ ...session })
  await page.clock.install()
  await setup(page, state)
  await page.goto('/training')
  await page.getByLabel('Go to date').fill(date)
  await expect(page.getByRole('button', { name: /Club pitch/ })).toBeVisible()
  state.sessions[0] = { ...session, revision: 2, venue: 'Moved pitch' }
  state.notices.push({ id: 'new-notice', title: 'Training moved', body: 'Training now starts at 19:00 on ' + date + '.', kind: 'moved', session_id: session.id, created_at: new Date().toISOString(), training_sessions: { ...state.sessions[0] } })
  // Only the notice inbox polls; the occurrence list is still revision 1.
  await page.clock.fastForward(61000)
  const inbox = page.getByRole('region', { name: 'Training notices', exact: true })
  await inbox.getByRole('link', { name: 'Update your availability' }).click()
  const detail = page.getByRole('dialog', { name: 'Training session' })
  await expect(detail.getByText('Moved pitch, Nottingham')).toBeVisible()
  await detail.getByRole('button', { name: 'In', exact: true }).click()
  await expect(detail.getByRole('button', { name: 'In', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(state.calls.find(call => call.name === 'reply_to_training').body.p_revision).toBe(2)
})
