import { adminClient, assertTargetAllowed, configured, createTestUsers, deleteTestData } from './users.js'

// Runs once before the whole E2E cycle: create the test users fresh.
export default async function globalSetup() {
  if (!configured()) {
    console.log('[e2e] no SUPABASE_SERVICE_ROLE_KEY / E2E creds — skipping test-user setup (authed specs will skip)')
    return
  }
  assertTargetAllowed() // refuses the live project unless E2E_ALLOW_LIVE=1
  const admin = adminClient()
  const swept = await deleteTestData(admin) // leftovers from a run that crashed before teardown
  if (swept) console.log(`[e2e] removed ${swept} leftover E2E opponent(s) and their fixtures`)
  await createTestUsers(admin)
  console.log('[e2e] test users created (fresh)')
}
