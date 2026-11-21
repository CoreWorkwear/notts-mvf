// Pure decisions for the authenticated e2e layer. No imports, so `node --test`
// can run them without Playwright, Vite or a database (see guards.node-test.js).

// The placeholder URL ci.yml builds against. The authed layer cannot work there
// (there is no project behind it), so it skips with a message instead.
export function isPlaceholderUrl(url) {
  if (!url) return false
  try { return /(^|[.-])placeholder([.-]|$)/i.test(new URL(url).hostname) } catch { return false }
}

// Is this auth user provably one the e2e suite made? The suite stamps
// user_metadata.e2e = true on creation. Accounts made before that stamp carry
// the first name 'E2E' (and a last name of Admin or Player), so accept those too.
// Anything else is a real person: never delete it.
export function isTestAccount(user) {
  const m = user?.user_metadata
  if (!m || typeof m !== 'object') return false
  if (m.e2e === true) return true
  return m.first_name === 'E2E' && (m.last_name === 'Admin' || m.last_name === 'Player')
}

// Throws unless `user` (an auth user found by email) may be deleted. Returns it.
export function assertDeletableTestUser(user, email) {
  if (isTestAccount(user)) return user
  throw new Error(
    `[e2e] ${email} already exists and is NOT a test account (no user_metadata.e2e marker, and its name is not ` +
    `"E2E Admin"/"E2E Player"). Refusing to delete it, as that would remove a real member and their history. ` +
    'Check E2E_ADMIN_EMAIL / E2E_PLAYER_EMAIL for a typo, or pick addresses that belong to the suite.'
  )
}
