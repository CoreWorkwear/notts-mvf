// Request-body validation for the Edge Functions (plain ESM, vitest-tested).
//
// Why this exists: send-push used to trust `profileIds` straight off the wire.
// LineupBoard can pass a null (an anonymised sub with no profile link), which
// PostgREST turns into `profile_id=in.(null,…)` → uuid cast error → the tokens
// read fails → `{ sent: 0 }` with no explanation. Reject the shape up front
// with a 400 that says what was wrong.

// The shape Postgres' uuid type accepts (hyphenated hex; case-insensitive).
// Deliberately NOT version-pinned: the RLS harness uses hand-made ids like
// a0000001-0000-0000-0000-000000000001.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(v) {
  return typeof v === 'string' && UUID.test(v)
}

// { ok: true, value } | { ok: false, error }. `required` false lets null/undefined through as null.
export function validateUuid(v, label = 'id', { required = true } = {}) {
  if (v === undefined || v === null || v === '') {
    return required ? { ok: false, error: `${label} is required` } : { ok: true, value: null }
  }
  if (!isUuid(v)) return { ok: false, error: `${label} must be a uuid` }
  return { ok: true, value: v.toLowerCase() }
}

// profileIds: absent → { ok, ids: null } (caller falls through to fixture /
// broadcast); otherwise a non-empty array of uuid strings, de-duplicated.
// Anything else — a bare string, a null inside the array, an object — is a 400.
export function validateProfileIds(input, { max = 500 } = {}) {
  if (input === undefined || input === null) return { ok: true, ids: null }
  if (!Array.isArray(input)) return { ok: false, error: 'profileIds must be an array of uuids' }
  if (input.length === 0) return { ok: false, error: 'profileIds must not be empty' }
  if (input.length > max) return { ok: false, error: `profileIds: at most ${max} at a time` }
  const bad = input.findIndex((v) => !isUuid(v))
  if (bad !== -1) return { ok: false, error: `profileIds[${bad}] is not a uuid` }
  return { ok: true, ids: [...new Set(input.map((s) => s.toLowerCase()))] }
}

// teams: absent → []; otherwise an array of short keys ('xl', 'community').
export function validateTeamKeys(input) {
  if (input === undefined || input === null) return { ok: true, keys: [] }
  if (!Array.isArray(input)) return { ok: false, error: 'teams must be an array of team keys' }
  const bad = input.findIndex((v) => typeof v !== 'string' || !/^[a-z0-9_-]{1,32}$/i.test(v))
  if (bad !== -1) return { ok: false, error: `teams[${bad}] is not a team key` }
  return { ok: true, keys: [...new Set(input)] }
}
