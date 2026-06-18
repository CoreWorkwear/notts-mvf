import { createClient } from '@supabase/supabase-js'

// E2E test users are EPHEMERAL: created fresh at the start of a test cycle
// (global-setup) and deleted at the end (global-teardown), so they never linger
// in the live DB polluting the squad/roster. Creating/deleting auth users needs
// the service-role key — set these in the env alongside the E2E_* creds:
//   SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
//   E2E_ADMIN_EMAIL/PASSWORD, E2E_PLAYER_EMAIL/PASSWORD
// Without them, setup/teardown no-op and the authed specs skip (no-auth smoke
// still runs).

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

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
