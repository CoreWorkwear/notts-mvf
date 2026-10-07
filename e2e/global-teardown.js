import { adminClient, configured, deleteTestData, deleteTestUsers, targetAllowed } from './users.js'

// Runs once after the whole E2E cycle: remove the test users AND the fixtures,
// results and opponents the write tests created, so nothing lingers in the
// database they ran against. If setup refused the target (live, without
// E2E_ALLOW_LIVE=1) nothing was created, so nothing is touched here either.
export default async function globalTeardown() {
  if (!configured() || !targetAllowed()) return
  const admin = adminClient()
  let swept = 0
  // The users go whatever happens to the sweep: one of them is an admin login.
  try { swept = await deleteTestData(admin) } finally { await deleteTestUsers(admin) }
  console.log(`[e2e] test users removed; ${swept} E2E opponent(s) and their fixtures removed`)
}
