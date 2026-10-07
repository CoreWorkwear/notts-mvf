import { adminClient, assertTargetAllowed, authedRequested, configured, createTestUsers, deleteTestData } from './users.js'

// Runs once before the whole E2E cycle: create the test users fresh.
export default async function globalSetup() {
  // No E2E_* emails (CI, and a plain local run): the authed specs skip
  // themselves and nothing here touches a database.
  if (!authedRequested()) {
    console.log('[e2e] no E2E creds — the authed specs will skip; the no-auth and stubbed layers run')
    return
  }
  // From here the authed specs WILL run, so anything short of a full, allowed
  // setup stops the whole run rather than let them sign in as users that do
  // not exist or write to a project nobody chose.
  assertTargetAllowed() // refuses live unless E2E_ALLOW_LIVE=1, and a shell URL that disagrees with the build
  if (!configured()) {
    throw new Error('[e2e] E2E_* emails are set but SUPABASE_SERVICE_ROLE_KEY or a password is missing, so the authed specs would run with no test users.')
  }
  const admin = adminClient()
  const swept = await deleteTestData(admin) // leftovers from a run that crashed before teardown
  if (swept) console.log(`[e2e] removed ${swept} leftover E2E opponent(s) and their fixtures`)
  await createTestUsers(admin)
  console.log('[e2e] test users created (fresh)')
}
