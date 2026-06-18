import { adminClient, configured, deleteTestUsers } from './users.js'

// Runs once after the whole E2E cycle: remove the test users so they never
// linger in the live DB.
export default async function globalTeardown() {
  if (!configured()) return
  await deleteTestUsers(adminClient())
  console.log('[e2e] test users removed')
}
