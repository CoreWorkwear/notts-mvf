import { randomUUID } from 'node:crypto'
import { devices, expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { loadEnv } from 'vite'
import { signIn } from './helpers.js'
import { addDaysISO, todayISO } from '../src/lib/format.js'

const env = loadEnv('production', process.cwd(), 'VITE_')
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const seededClub = '11111111-1111-1111-1111-111111111111'
const authOptions = { auth: { persistSession: false, autoRefreshToken: false } }

test.use({ actionTimeout: 8_000, navigationTimeout: 12_000, serviceWorkers: 'block' })

async function checked(request) {
  const { data, error } = await request
  if (error) throw new Error(error.message)
  return data
}

async function member(admin, firstName, role, clubId = seededClub) {
  const email = `subs-proof-${randomUUID()}@example.com`
  const password = randomUUID()
  const lastName = `SubsProof-${randomUUID().slice(0, 8)}`
  const { user } = await checked(admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { first_name: firstName, last_name: lastName, phone: '07700900912', teams: ['xl'] },
  }))
  await checked(admin.from('profiles').update({ active: true, approved: true, role, club_id: clubId }).eq('id', user.id))
  return { id: user.id, email, password, name: `${firstName} ${lastName}` }
}

async function signedIn(member) {
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, authOptions)
  await checked(client.auth.signInWithPassword({ email: member.email, password: member.password }))
  return client
}

async function release(admin, enabled) {
  await checked(admin.rpc('set_club_payments_release', {
    p_club_id: seededClub, p_enabled: enabled, p_cutover: enabled,
  }))
}

test('a manager records a receipt and the player sees it once on their phone', async ({ browser, browserName, page }, testInfo) => {
  test.skip(process.env.E2E_PAYMENTS_LOCAL !== '1', 'requires the isolated payments database')
  // This test creates ledger history and toggles the club release. Only the
  // disposable stack seeded for this proof may be used.
  expect(env.VITE_SUPABASE_URL).toBe('http://127.0.0.1:55421')
  expect(serviceKey).toBeTruthy()
  test.setTimeout(75_000)
  const admin = createClient(env.VITE_SUPABASE_URL, serviceKey, authOptions)
  const members = []
  const proofDate = todayISO()
  const bankReference = `Phone proof ${randomUUID().slice(0, 8)}`
  let putReleaseBack = false
  const manager = await member(admin, 'Manager', 'admin')
  members.push(manager)
  try {
    const player = await member(admin, 'Sam', 'player')
    members.push(player)
    const other = await member(admin, 'Taylor', 'player')
    members.push(other)
    const creditPlayer = await member(admin, 'Credit', 'player')
    const settledPlayer = await member(admin, 'Settled', 'player')
    members.push(creditPlayer, settledPlayer)
    const separateClub = await checked(admin.from('clubs').insert({ name: 'Subs proof other club' }).select('id').single())
    const outside = await member(admin, 'Outside', 'admin', separateClub.id)
    members.push(outside)

    await release(admin, true)
    putReleaseBack = true
    await signIn(page, manager.email, manager.password)
    await page.getByRole('button', { name: 'Manager view' }).click()
    const managerApi = await signedIn(manager)
    const beforeOpenings = await checked(managerApi.rpc('get_account_opening_summary'))
    await page.goto('/manage')
    await page.getByRole('link', { name: 'Opening balances' }).click()
    await expect(page.getByRole('heading', { name: 'Opening balances' })).toBeVisible()
    const openingDirection = page.getByLabel('Opening balance', { exact: true })
    await page.route('**/rest/v1/rpc/record_account_opening', async route => {
      const response = await route.fetch()
      if (!response.ok()) return route.fulfill({ response })
      await route.abort('failed')
    }, { times: 1 })
    for (const opening of [
      { member: player, direction: 'arrears', amount: '7.00' },
      { member: creditPlayer, direction: 'credit', amount: '18.00' },
      { member: settledPlayer, direction: 'settled' },
    ]) {
      await page.getByLabel('Player', { exact: true }).selectOption(opening.member.id)
      await openingDirection.selectOption(opening.direction)
      if (opening.amount) await page.getByLabel('Amount (£)').fill(opening.amount)
      await page.getByRole('button', { name: 'Save opening balance' }).click()
      if (opening.member === player) await page.getByRole('button', { name: 'Retry opening balance' }).click()
      await expect(page.getByRole('region', { name: 'Opening records' }).getByText(opening.member.name, { exact: true })).toBeVisible()
    }
    const afterOpenings = await checked(managerApi.rpc('get_account_opening_summary'))
    expect(afterOpenings.account_count).toBe(beforeOpenings.account_count + 3)
    expect(afterOpenings.opening_credit_pence).toBe(beforeOpenings.opening_credit_pence + 1800)
    expect(afterOpenings.opening_arrears_pence).toBe(beforeOpenings.opening_arrears_pence + 700)
    expect(afterOpenings.settled_count).toBe(beforeOpenings.settled_count + 1)
    const settled = await checked(managerApi.rpc('get_player_account', { p_profile_id: settledPlayer.id }))
    expect(settled.balance_pence).toBe(0)
    expect(settled.entries.map(entry => entry.description)).toEqual(['Opening balance'])
    await page.goto('/players')
    await page.getByRole('button', { name: `Account for ${player.name}` }).click()
    const dialog = page.getByRole('dialog', { name: 'Player account' })
    await expect(dialog.getByText('£7.00 owed', { exact: true }).first()).toBeVisible()
    await dialog.getByRole('button', { name: 'Record receipt' }).click()
    await dialog.getByLabel('Amount (£)').fill('20.00')
    await dialog.getByLabel('Received on').fill(proofDate)
    await dialog.getByLabel('Method').selectOption('bank')
    await dialog.getByLabel('Bank reference (optional)').fill(bankReference)

    // Commit the real RPC, then lose its response. The manager must retry the
    // same operation and must see one posted receipt.
    await page.route('**/rest/v1/rpc/record_account_receipt', async route => {
      const response = await route.fetch()
      if (!response.ok()) return route.fulfill({ response })
      await route.abort('failed')
    }, { times: 1 })
    await dialog.getByRole('button', { name: 'Save receipt' }).click()
    await dialog.getByRole('button', { name: 'Retry receipt' }).click()
    await expect(dialog.getByText('Receipt recorded.')).toBeVisible()

    await dialog.getByRole('button', { name: 'Fine or correction' }).click()
    await dialog.getByLabel('Amount (£)').fill('5.00')
    await dialog.getByLabel('Reason').fill('Synthetic fine')
    await dialog.getByRole('button', { name: 'Save change' }).click()
    await expect(dialog.getByText('£8.00 in credit', { exact: true }).first()).toBeVisible()

    await dialog.getByRole('button', { name: 'Fine or correction' }).click()
    await dialog.getByLabel('Action', { exact: true }).selectOption('reversal')
    const original = dialog.getByLabel('Original transaction')
    const fineOption = original.locator('option').filter({ hasText: 'Synthetic fine' })
    await original.selectOption(await fineOption.getAttribute('value'))
    await dialog.getByLabel('Reason').fill('Synthetic fine withdrawn')
    await dialog.getByRole('button', { name: 'Save change' }).click()
    await expect(dialog.getByText('£13.00 in credit', { exact: true }).first()).toBeVisible()

    const device = browserName === 'webkit' ? devices['iPhone 14'] : devices['Pixel 7']
    const { defaultBrowserType: _engine, ...phoneOptions } = device
    const playerContext = await browser.newContext({ ...phoneOptions, baseURL: 'http://localhost:4173', serviceWorkers: 'block' })
    try {
      const phone = await playerContext.newPage()
      await signIn(phone, player.email, player.password)
      await phone.getByRole('link', { name: 'You', exact: true }).tap()
      await expect(phone.getByText('£13.00 in credit').first()).toBeVisible()
      const statement = phone.getByRole('region', { name: 'Account transactions' })
      await expect(statement.getByText(`Reference: ${bankReference}`, { exact: true })).toHaveCount(1)
      await expect(statement.getByText('Bank transfer', { exact: true })).toBeVisible()
      await expect(statement.getByText('Opening balance', { exact: true })).toBeVisible()
      const receipt = statement.locator('li').filter({ hasText: bankReference })
      await expect(receipt).toContainText('+£20.00')
      await expect(receipt.locator('time')).toHaveAttribute('datetime', proofDate)
      await expect(receipt).toContainText('£13.00 in credit')
      await expect(statement.getByText('Reversal: Synthetic fine withdrawn', { exact: true })).toBeVisible()
      await phone.screenshot({ path: testInfo.outputPath('player-statement.png') })
      await phone.getByRole('link', { name: 'Edit details' }).tap()
      await expect(phone.getByRole('heading', { name: 'Edit details' })).toBeVisible()
      await expect(phone.getByLabel('Sign-in email')).toHaveAttribute('readonly', '')
      await phone.getByLabel('Phone', { exact: true }).fill('07700900937')
      await phone.getByRole('button', { name: 'Save changes' }).tap()
      await expect(phone.getByRole('heading', { name: 'Balance and statement' })).toBeVisible()
      await phone.getByRole('link', { name: 'Edit details' }).tap()
      await expect(phone.getByLabel('Phone', { exact: true })).toHaveValue('07700900937')
      await phone.getByRole('link', { name: 'Back' }).tap()
      await phone.reload()
      await expect(phone.getByText('£13.00 in credit').first()).toBeVisible()
    } finally {
      await playerContext.close()
    }

    const playerApi = await signedIn(player)
    const outsideApi = await signedIn(outside)
    expect((await playerApi.rpc('get_player_account', { p_profile_id: other.id })).error?.code).toBe('42501')
    expect((await outsideApi.rpc('get_player_account', { p_profile_id: player.id })).error?.code).toBe('42501')
    expect((await playerApi.rpc('post_account_entry', { p_entry: {} })).error).toBeTruthy()
    const account = await checked(managerApi.rpc('get_player_account', { p_profile_id: player.id }))
    expect(account.balance_pence).toBe(1300)
    expect(account.entries.filter(entry => entry.reference === bankReference)).toHaveLength(1)
    const empty = await checked(managerApi.rpc('get_player_account', { p_profile_id: other.id }))
    expect(empty.balance_pence).toBe(0)
    expect(empty.entries).toEqual([])

    // Several concurrent authenticated REST calls can race for the same
    // logical receipt. A separate receipt of equal value still posts.
    const cashReceipt = {
      p_request_id: randomUUID(), p_profile_id: player.id, p_amount_pence: 2000,
      p_method: 'cash', p_received_on: proofDate,
    }
    const [posted, replay] = await Promise.all([
      checked(managerApi.rpc('record_account_receipt', cashReceipt)),
      checked(managerApi.rpc('record_account_receipt', cashReceipt)),
    ])
    expect(replay).toBe(posted)
    expect((await managerApi.rpc('record_account_receipt', { ...cashReceipt, p_method: 'bank' })).error?.code).toBe('22023')
    const direct = await playerApi.from('account_entries').insert({ amount_pence: 1 })
    expect(direct.error?.code).toBe('42501')
    const afterCash = await checked(playerApi.rpc('get_player_account'))
    expect(afterCash.balance_pence).toBe(3300)
    expect(afterCash.entries.filter(entry => entry.kind === 'receipt').map(entry => entry.source)).toEqual(['bank', 'cash'])

    await page.goto('/manage')
    await page.getByRole('link', { name: 'Fees', exact: true }).click()
    const card = page.getByRole('region', { name: 'First Team match subs' })
    await expect(card.getByRole('button', { name: 'Set rate' })).toBeVisible()
    for (const [amount, effective] of [['7.00', proofDate], ['10.00', addDaysISO(proofDate, 1)]]) {
      await card.getByRole('button', { name: 'Set rate' }).click()
      await card.getByLabel('New amount (£)').fill(amount)
      await card.getByLabel('Effective from').fill(effective)
      await card.getByRole('button', { name: 'Save rate' }).click()
      await expect(card.getByText('Fee rate saved.')).toBeVisible()
    }
    await expect(card.getByText('£7.00', { exact: true })).toBeVisible()
    await expect(card.getByText('£10.00', { exact: true })).toBeVisible()

    await page.getByRole('link', { name: 'Back to Club admin' }).click()
    await page.getByRole('link', { name: 'Activity charges' }).click()
    await expect(page.getByRole('heading', { name: 'Activity charges' })).toBeVisible()
    await page.getByLabel('From', { exact: true }).fill(proofDate)
    await page.getByLabel('To', { exact: true }).fill(proofDate)
    await page.getByRole('button', { name: 'Show report' }).click()
    await expect(page.getByRole('table', { name: 'Activity charge totals' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Club receipts' })).toBeVisible()
    await page.getByText('Receipt reconciliation details', { exact: true }).click()
    await expect(page.getByText(bankReference, { exact: false })).toBeVisible()

    await release(admin, false)
    putReleaseBack = false
    const refused = await managerApi.rpc('record_account_receipt', {
      p_request_id: randomUUID(), p_profile_id: player.id, p_amount_pence: 100,
      p_method: 'cash', p_received_on: proofDate,
    })
    expect(refused.error?.code).toBe('42501')
  } finally {
    if (putReleaseBack) await release(admin, false)
    for (const member of members) await checked(admin.auth.admin.deleteUser(member.id))
  }
})

test('confirmed match appearances charge the players who took part', async ({ page }) => {
  test.skip(process.env.E2E_PAYMENTS_LOCAL !== '1', 'requires the isolated payments database')
  expect(env.VITE_SUPABASE_URL).toBe('http://127.0.0.1:55421')
  expect(serviceKey).toBeTruthy()
  const admin = createClient(env.VITE_SUPABASE_URL, serviceKey, authOptions)
  const members = []
  let fixtureId
  let opponentId
  let enabled = false
  try {
    const manager = await member(admin, 'Match manager', 'admin')
    members.push(manager)
    const starter = await member(admin, 'Starter', 'player')
    members.push(starter)
    const usedSub = await member(admin, 'Used sub', 'player')
    members.push(usedSub)
    const unusedSub = await member(admin, 'Unused sub', 'player')
    members.push(unusedSub)
    await release(admin, true)
    enabled = true
    const managerApi = await signedIn(manager)
    const matchDate = '2026-10-15'
    await checked(managerApi.rpc('set_club_fee_rate', {
      p_category: 'first_team', p_amount_pence: 700, p_effective_from: matchDate,
    }))
    await checked(managerApi.rpc('set_club_fee_rate', {
      p_category: 'first_team', p_amount_pence: 1000, p_effective_from: addDaysISO(matchDate, 1),
    }))
    const opponent = await checked(admin.from('opponents').insert({
      club_id: seededClub, name: `Appearance proof ${randomUUID().slice(0, 8)}`,
    }).select('id').single())
    opponentId = opponent.id
    const fixture = await checked(admin.from('fixtures').insert({
      club_id: seededClub, season_id: '22222222-2222-2222-2222-222222222222',
      team_id: '33333333-3333-3333-3333-333333333333', opponent_id: opponentId,
      match_date: matchDate, kickoff: '12:00', venue: 'Test pitch',
    }).select('id').single())
    fixtureId = fixture.id
    await checked(admin.from('results').insert({ fixture_id: fixtureId, us: 2, them: 1 }))
    await checked(admin.from('lineups').insert([
      { fixture_id: fixtureId, profile_id: starter.id, role: 'start', position: 'ST', slot: 10 },
      { fixture_id: fixtureId, profile_id: usedSub.id, role: 'sub' },
      { fixture_id: fixtureId, profile_id: unusedSub.id, role: 'sub' },
    ]))
    const account = id => checked(managerApi.rpc('get_player_account', { p_profile_id: id }))
    expect((await account(starter.id)).entries).toEqual([])

    await signIn(page, manager.email, manager.password)
    await page.getByRole('button', { name: 'Manager view' }).click()
    await page.getByRole('link', { name: 'Results', exact: true }).tap()
    await page.getByRole('button', { name: /Match centre/ }).tap()
    await page.getByRole('button', { name: 'Confirm who played' }).tap()
    const register = page.getByRole('region', { name: 'Match attendance' })
    await expect(register.getByText(/£7\.00 per appearance/)).toBeVisible()
    const starterBox = register.getByRole('checkbox', { name: starter.name, exact: true })
    const subBox = register.getByRole('checkbox', { name: usedSub.name, exact: true })
    await expect(starterBox).not.toBeChecked()
    await expect(register.getByRole('checkbox', { name: unusedSub.name, exact: true })).not.toBeChecked()
    await starterBox.check()
    await subBox.check()
    await register.getByRole('button', { name: 'Save attendance' }).tap()
    await expect(register.getByText(/^Attendance saved/)).toBeVisible()
    expect((await account(starter.id)).balance_pence).toBe(-700)
    expect((await account(usedSub.id)).balance_pence).toBe(-700)
    expect((await account(unusedSub.id)).entries).toEqual([])

    await starterBox.uncheck()
    await register.getByRole('button', { name: 'Save attendance' }).tap()
    await expect(register.getByText(/^Attendance saved/)).toBeVisible()
    const corrected = await account(starter.id)
    expect(corrected.balance_pence).toBe(0)
    expect(corrected.entries.map(entry => entry.amount_pence)).toEqual([-700, 700])
    expect(corrected.entries[1].linked_entry_id).toBe(corrected.entries[0].id)
    expect((await account(usedSub.id)).entries).toHaveLength(1)
  } finally {
    if (fixtureId) await checked(admin.from('fixtures').delete().eq('id', fixtureId))
    if (opponentId) await checked(admin.from('opponents').delete().eq('id', opponentId))
    if (enabled) await release(admin, false)
    for (const person of members) await checked(admin.auth.admin.deleteUser(person.id))
  }
})

test('confirmed training attendance charges each occurrence independently', async ({ page }) => {
  test.skip(process.env.E2E_PAYMENTS_LOCAL !== '1', 'requires the isolated payments database')
  expect(env.VITE_SUPABASE_URL).toBe('http://127.0.0.1:55421')
  expect(serviceKey).toBeTruthy()
  const admin = createClient(env.VITE_SUPABASE_URL, serviceKey, authOptions)
  const members = []
  const sessionIds = []
  let enabled = false
  try {
    const manager = await member(admin, 'Training manager', 'admin')
    members.push(manager)
    const attended = await member(admin, 'Attended', 'player')
    members.push(attended)
    const replied = await member(admin, 'Replied', 'player')
    members.push(replied)
    await release(admin, true)
    enabled = true
    const managerApi = await signedIn(manager)
    const firstDate = '2026-10-15'
    const nextDate = addDaysISO(firstDate, 7)
    for (const [date, amount] of [[firstDate, 400], [nextDate, 600]]) {
      await checked(managerApi.rpc('set_club_fee_rate', {
        p_category: 'training', p_amount_pence: amount, p_effective_from: date,
      }))
    }
    const series = randomUUID()
    const sessions = await checked(admin.from('training_sessions').insert([firstDate, nextDate].map(start_date => ({
      club_id: seededClub, series_id: series, venue: 'Training proof pitch',
      start_date, start_time: '19:00', audience: 'club',
    }))).select('id,start_date'))
    sessionIds.push(...sessions.map(item => item.id))
    const first = sessions.find(item => item.start_date === firstDate)
    const next = sessions.find(item => item.start_date === nextDate)
    await checked(admin.from('training_replies').insert({ session_id: first.id, profile_id: replied.id, status: 'in' }))
    const account = id => checked(managerApi.rpc('get_player_account', { p_profile_id: id }))
    expect((await account(replied.id)).entries).toEqual([])

    await signIn(page, manager.email, manager.password)
    await page.getByRole('button', { name: 'Manager view' }).click()
    await page.goto(`/training?session=${first.id}`)
    await page.getByRole('button', { name: 'Confirm who attended' }).tap()
    const register = page.getByRole('region', { name: 'Training attendance' })
    await expect(register.getByText(/£4\.00 per attendee/)).toBeVisible()
    const attendedBox = register.getByRole('checkbox', { name: attended.name, exact: true })
    await expect(register.getByRole('checkbox', { name: replied.name, exact: true })).not.toBeChecked()
    await attendedBox.check()
    await register.getByRole('button', { name: 'Save attendance' }).tap()
    await expect(register.getByText(/^Attendance saved/)).toBeVisible()
    const posted = await account(attended.id)
    expect(posted.balance_pence).toBe(-400)
    expect(posted.entries[0].category).toBe('training')
    expect(posted.entries[0].activity_id).toBe(first.id)
    expect((await account(replied.id)).entries).toEqual([])
    const nextRegister = await checked(managerApi.rpc('get_training_attendance_register', { p_session_id: next.id }))
    expect(nextRegister.confirmed_profile_ids).toEqual([])
    expect(nextRegister.rate.amount_pence).toBe(600)

    await attendedBox.uncheck()
    await register.getByRole('button', { name: 'Save attendance' }).tap()
    await expect(register.getByText(/^Attendance saved/)).toBeVisible()
    const corrected = await account(attended.id)
    expect(corrected.balance_pence).toBe(0)
    expect(corrected.entries[1].linked_entry_id).toBe(posted.entries[0].id)
  } finally {
    if (sessionIds.length) await checked(admin.from('training_sessions').delete().in('id', sessionIds))
    if (enabled) await release(admin, false)
    for (const person of members) await checked(admin.auth.admin.deleteUser(person.id))
  }
})
