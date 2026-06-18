import { adminClient, configured, createTestUsers } from './users.js'

// Runs once before the whole E2E cycle: create the test users fresh.
export default async function globalSetup() {
  if (!configured()) {
    console.log('[e2e] no SUPABASE_SERVICE_ROLE_KEY / E2E creds — skipping test-user setup (authed specs will skip)')
    return
  }
  await createTestUsers(adminClient())
  console.log('[e2e] test users created (fresh)')
}
