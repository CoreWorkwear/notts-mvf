// Decision logic for admin-create-player / admin-delete-player (plain ESM,
// vitest-tested; the Supabase calls are injected).

export const DELETE_ADMIN_MESSAGE = "Managers can't be deleted here. Take their manager role off first."

// Before the delete RPC: may this caller delete this target?
// targetRole: the role read with the service client (null when no row).
export function decideDeleteTarget({ callerId, targetId, targetRole }) {
  if (targetId === callerId) return { ok: false, status: 400, error: "You can't delete your own account." }
  if (targetRole === 'admin') return { ok: false, status: 403, error: DELETE_ADMIN_MESSAGE }
  return { ok: true }
}

// Friendly line for the RPC's known failures; anything else is null (→ generic 500).
export function mapDeleteRpcError(err) {
  if (err?.code === '42501') return { status: 403, error: "That player isn't in your club, or can't be deleted here." }
  if (err?.code === 'P0002') return { status: 404, error: 'That player no longer exists.' }
  return null
}

// The profile is already gone. Delete the login; retry once; if it still
// fails, ban it so it can't be used. deleteUser/banUser resolve to { error }.
export async function removeLoginOrBlock({ deleteUser, banUser }) {
  let first = await safe(deleteUser)
  if (!first.error) return { ok: true }
  let second = await safe(deleteUser)
  if (!second.error) return { ok: true, retried: true }
  const ban = await safe(banUser)
  const banned = !ban.error
  return {
    ok: false,
    banned,
    status: 500,
    code: second.error?.code ?? second.error?.status ?? null,
    error: banned
      ? 'The profile is removed, but the login could not be deleted. It has been blocked so it cannot be used.'
      : 'The profile is removed, but the login could not be deleted or blocked. Tell the club developer.',
  }
}

async function safe(fn) {
  try { return (await fn()) ?? {} } catch (e) { return { error: e ?? new Error('failed') } }
}

// createUser failures worth telling the manager about; anything else is null (→ generic 500).
export function mapCreateUserError(err) {
  const code = String(err?.code ?? '')
  if (code === 'email_exists' || code === 'user_already_exists' || /already (been )?registered/i.test(err?.message ?? '')) {
    return { status: 400, error: 'A login with that email already exists.' }
  }
  if (code === 'weak_password') return { status: 400, error: 'That password is too weak. Try a longer one.' }
  if (code === 'email_address_invalid' || code === 'validation_failed') return { status: 400, error: "That email address doesn't look right." }
  return null
}

// After createUser: did the new profile land in the caller's club? A failed or
// empty read counts as "no" — the login is then undone.
export function profileInCallerClub({ made, madeErr, callerClub }) {
  return !madeErr && !!made && !!callerClub && made.club_id === callerClub
}
