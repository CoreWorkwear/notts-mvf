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

// Position codes — duplicated from src/lib/constants.js (Deno can't import
// src/); validate.test.js asserts the two lists match.
export const POSITION_CODES = ['GK', 'RB', 'CB', 'LB', 'CDM', 'CM', 'CAM', 'RM', 'LM', 'RW', 'LW', 'ST', 'CF']

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_CHARS = /^[0-9 +\-()]+$/

function reqString(v, label, min, max) {
  if (typeof v !== 'string') return { error: `${label} is required` }
  const t = v.trim()
  if (t.length < min) return { error: `${label} is required` }
  if (t.length > max) return { error: `${label} is too long (at most ${max} characters)` }
  return { value: t }
}

function realDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

// Body of admin-create-player. { ok: true, value } with trimmed, normalised
// fields, or { ok: false, error } naming the first problem. `teams` is left
// to validateTeamKeys. `now` is injectable for tests.
export function validatePlayerBody(b, { now = new Date(), requirePhone = false, minPassword = 10 } = {}) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { ok: false, error: 'body must be a JSON object' }
  const fail = (error) => ({ ok: false, error })

  const email = reqString(b.email, 'email', 1, 254)
  if (email.error) return fail(email.error)
  if (!EMAIL_SHAPE.test(email.value)) return fail("that email address doesn't look right")

  if (typeof b.password !== 'string' || !b.password) return fail('password is required')
  if (b.password.length < minPassword) return fail(`password must be at least ${minPassword} characters`)
  if (b.password.length > 72) return fail('password is too long (at most 72 characters)')

  const first = reqString(b.first_name, 'first name', 1, 60)
  if (first.error) return fail(first.error)
  const last = reqString(b.last_name, 'surname', 1, 60)
  if (last.error) return fail(last.error)

  let phone = null
  if (b.phone !== undefined && b.phone !== null && b.phone !== '') {
    if (typeof b.phone !== 'string') return fail('phone must be text')
    phone = b.phone.trim()
    if (phone.length > 30) return fail('phone is too long (at most 30 characters)')
    if (phone && !PHONE_CHARS.test(phone)) return fail('phone can only use digits, spaces, + - and brackets')
    if (!phone) phone = null
  }
  if (requirePhone && !phone) return fail('phone is required')

  let positions = []
  if (b.positions !== undefined && b.positions !== null) {
    if (!Array.isArray(b.positions)) return fail('positions must be a list')
    const bad = b.positions.findIndex((p) => typeof p !== 'string' || !POSITION_CODES.includes(p))
    if (bad !== -1) return fail(`positions[${bad}] is not a known position`)
    positions = [...new Set(b.positions)]
  }

  let preferred = null
  if (b.preferred !== undefined && b.preferred !== null && b.preferred !== '') {
    if (typeof b.preferred !== 'string' || !POSITION_CODES.includes(b.preferred)) return fail('preferred is not a known position')
    preferred = b.preferred
  }

  let dob = null
  if (b.dob !== undefined && b.dob !== null && b.dob !== '') {
    if (typeof b.dob !== 'string' || !realDate(b.dob)) return fail('date of birth must be a real date (YYYY-MM-DD)')
    const today = now.toISOString().slice(0, 10)
    if (b.dob > today) return fail("date of birth can't be in the future")
    if (b.dob < '1900-01-01') return fail('date of birth must be after 1900')
    dob = b.dob
  }

  if (b.is_player !== undefined && b.is_player !== null && typeof b.is_player !== 'boolean') return fail('is_player must be true or false')

  return {
    ok: true,
    value: {
      email: email.value, password: b.password, first_name: first.value, last_name: last.value,
      phone, positions, preferred, dob, is_player: b.is_player !== false,
    },
  }
}
