// Shared caller checks for the Edge Functions (plain ESM, vitest-tested).
// Dependencies are injected so the decisions run without Deno or Supabase.

// Constant-time string comparison. Both sides are hashed to a fixed-length
// SHA-256 digest first (so length never leaks), then every byte is compared.
export async function timingSafeEqualStrings(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const enc = new TextEncoder()
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ])
  const x = new Uint8Array(da)
  const y = new Uint8Array(db)
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

// The token check + active-admin lookup the three admin functions share.
//   getUser()        → { data: { user }, error }   (the caller's JWT)
//   loadProfile(id)  → { data: { role, active, club_id }, error }  (service client)
// Mirrors the DB's is_admin(): role AND active, so a soft-removed manager
// loses these powers too. Returns { ok: true, user, me } or
// { ok: false, status, error, event, code } (event/code are for the log).
export async function requireActiveAdmin({ getUser, loadProfile }) {
  const { data, error } = await getUser()
  const user = data?.user ?? null
  if (error || !user) return { ok: false, status: 401, error: 'unauthorized', event: 'unauthorized', code: null }
  const { data: me, error: meErr } = await loadProfile(user.id)
  if (meErr || me?.role !== 'admin' || me?.active !== true) {
    return { ok: false, status: 403, error: 'forbidden', event: 'forbidden', code: meErr?.code ?? null, user }
  }
  return { ok: true, user, me }
}
