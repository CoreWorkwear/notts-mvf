import { createClient } from '@supabase/supabase-js'
import { loadEnv } from 'vite'

// E2E test users are EPHEMERAL: created fresh at the start of a test cycle
// (global-setup) and deleted at the end (global-teardown), so they never linger
// in the database polluting the squad/roster. Creating/deleting auth users needs
// the service-role key — set these in the env alongside the E2E_* creds:
//   SUPABASE_SERVICE_ROLE_KEY, E2E_ADMIN_EMAIL/PASSWORD, E2E_PLAYER_EMAIL/PASSWORD
// Without the E2E_* emails, setup/teardown no-op and the authed specs skip (the
// no-auth and stubbed layers still run).
//
// ONE project, decided by the build. The browser under test talks to whatever
// VITE_SUPABASE_URL the app was built with (.env, or the shell, which wins), so
// the admin client here uses that same URL. Taking it from a separate
// SUPABASE_URL let the two disagree: users created on one project while the
// browser signed in to, and wrote fixtures on, the other.
const SUPABASE_URL = loadEnv('production', process.cwd(), 'VITE_').VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// True when the run has been asked to do the authenticated layer at all — the
// same gate authed.spec.js skips on.
export const authedRequested = () => !!(process.env.E2E_ADMIN_EMAIL || process.env.E2E_PLAYER_EMAIL)

export const TEST_USERS = [
  {
    role: 'admin', email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD,
    meta: { first_name: 'E2E', last_name: 'Admin', phone: '07700900900', teams: ['xl', 'community'], is_player: true },
  },
  {
    role: 'player', email: process.env.E2E_PLAYER_EMAIL, password: process.env.E2E_PLAYER_PASSWORD,
    meta: { first_name: 'E2E', last_name: 'Player', phone: '07700900901', teams: ['xl', 'community'], is_player: true },
  },
]

export function adminClient() {
  if (!SUPABASE_URL || !SERVICE_KEY) return null
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
}

// Configured = we have a service-role client AND both users' creds.
export function configured() {
  return !!(adminClient() && TEST_USERS.every((u) => u.email && u.password))
}

// The live project. The authed layer WRITES to whatever the build points at —
// test users, fixtures, a logged result — and the only local .env is live's.
// So running it there has to be said out loud rather than happen by default.
const LIVE_REF = 'vgeosccpwsdosbcnpcve'
const host = (u) => { try { return new URL(u).hostname } catch { return '' } }
export function targetAllowed() {
  return !host(SUPABASE_URL).includes(LIVE_REF) || process.env.E2E_ALLOW_LIVE === '1'
}
export function assertTargetAllowed() {
  // A stray SUPABASE_URL in the shell used to steer the admin client only.
  const shell = process.env.SUPABASE_URL
  if (shell && host(shell) !== host(SUPABASE_URL)) {
    throw new Error(
      `[e2e] SUPABASE_URL in the shell (${host(shell)}) is not the project the app is built against ` +
      `(${host(SUPABASE_URL) || 'VITE_SUPABASE_URL is not set'}). The browser follows the build. ` +
      'Unset SUPABASE_URL, and set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY to choose the project.'
    )
  }
  if (targetAllowed()) return
  throw new Error(
    '[e2e] The authenticated layer would run against the LIVE Supabase project, and it writes real rows ' +
    '(test users, fixtures, a result). To run it there on purpose set E2E_ALLOW_LIVE=1. To run it on ' +
    'staging, set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to staging in the shell (they override ' +
    '.env) with staging\'s SUPABASE_SERVICE_ROLE_KEY. With no E2E_* emails set, this layer is skipped.'
  )
}

// Everything the write tests create hangs off an opponent named "E2E-…"
// (authed.spec.js). Deleting the test users removes none of it — fixtures and
// opponents reference no profile — so it used to stay in the real season until
// a manager binned it by hand. Deleting the fixtures cascades to their results,
// goals, line-ups and availability.
export async function deleteTestData(admin) {
  const { data: opps, error } = await admin.from('opponents').select('id').like('name', 'E2E-%')
  if (error) throw new Error(`find E2E opponents: ${error.message}`)
  const ids = (opps ?? []).map((o) => o.id)
  if (!ids.length) return 0
  const fx = await admin.from('fixtures').delete().in('opponent_id', ids)
  if (fx.error) throw new Error(`delete E2E fixtures: ${fx.error.message}`)
  const op = await admin.from('opponents').delete().in('id', ids)
  if (op.error) throw new Error(`delete E2E opponents: ${op.error.message}`)
  return ids.length
}

// admin.listUsers is paginated and has no email filter — scan a few pages.
async function findUserId(admin, email) {
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error || !data?.users?.length) break
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (hit) return hit.id
    if (data.users.length < 200) break
  }
  return null
}

export async function deleteTestUsers(admin) {
  for (const u of TEST_USERS) {
    const id = await findUserId(admin, u.email)
    if (id) await admin.auth.admin.deleteUser(id) // cascades to profile + its rows
  }
}

export async function createTestUsers(admin) {
  for (const u of TEST_USERS) {
    const existing = await findUserId(admin, u.email) // clean any leftover from a crashed run
    if (existing) await admin.auth.admin.deleteUser(existing)

    const { data, error } = await admin.auth.admin.createUser({
      email: u.email, password: u.password, email_confirm: true, user_metadata: u.meta,
    })
    if (error) throw new Error(`create ${u.email}: ${error.message}`)

    // The signup trigger forces role=player and lands them pending; elevate here
    // (service_role bypasses the protect-columns trigger).
    const patch = u.role === 'admin'
      ? { role: 'admin', approved: true, is_player: true }
      : { approved: true, is_player: true }
    const { error: pe } = await admin.from('profiles').update(patch).eq('id', data.user.id)
    if (pe) throw new Error(`elevate ${u.email}: ${pe.message}`)
  }
}
