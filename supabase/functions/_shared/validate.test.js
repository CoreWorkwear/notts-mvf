import { describe, test, expect } from 'vitest'
import { validatePlayerBody, POSITION_CODES } from './validate.js'
import { POSITIONS } from '../../../src/lib/constants.js'
import { isUuid, validateUuid, validateProfileIds, validateTeamKeys } from './validate.js'

const U1 = 'a0000001-0000-0000-0000-000000000001'
const U2 = '3F2504E0-4F89-11D3-9A0C-0305E82C3301'

describe('isUuid', () => {
  test('hyphenated hex only, any case; nothing else', () => {
    expect(isUuid(U1)).toBe(true)
    expect(isUuid(U2)).toBe(true)
    expect(isUuid('p1')).toBe(false)
    expect(isUuid(null)).toBe(false)
    expect(isUuid('')).toBe(false)
    expect(isUuid(`${U1} `)).toBe(false)
    expect(isUuid(`${U1}' or 1=1`)).toBe(false)
  })
})

describe('validateUuid', () => {
  test('required by default; optional lets null through as null', () => {
    expect(validateUuid(U2, 'id')).toEqual({ ok: true, value: U2.toLowerCase() })
    expect(validateUuid(undefined, 'id')).toEqual({ ok: false, error: 'id is required' })
    expect(validateUuid('nope', 'fixtureId')).toEqual({ ok: false, error: 'fixtureId must be a uuid' })
    expect(validateUuid(null, 'fixtureId', { required: false })).toEqual({ ok: true, value: null })
  })
})

// Finding B — the LineupBoard case: an anonymised sub gives a null in the
// array. Old code passed it to `.in('profile_id', …)` → uuid cast error →
// tokens null → { sent: 0 } with no explanation.
describe('validateProfileIds', () => {
  test('absent → ids null (fall through to fixture / broadcast)', () => {
    expect(validateProfileIds(undefined)).toEqual({ ok: true, ids: null })
    expect(validateProfileIds(null)).toEqual({ ok: true, ids: null })
  })
  test('a null inside the array is a 400, naming the index', () => {
    expect(validateProfileIds([U1, null])).toEqual({ ok: false, error: 'profileIds[1] is not a uuid' })
  })
  test('non-array, empty, or non-uuid members are 400s', () => {
    expect(validateProfileIds(U1).ok).toBe(false)
    expect(validateProfileIds({ 0: U1 }).ok).toBe(false)
    expect(validateProfileIds([]).ok).toBe(false)
    expect(validateProfileIds(['p1']).ok).toBe(false)
    expect(validateProfileIds([U1, 42]).ok).toBe(false)
  })
  test('too many at once is refused', () => {
    expect(validateProfileIds(Array(501).fill(U1)).ok).toBe(false)
    expect(validateProfileIds(Array(500).fill(U1)).ok).toBe(true)
  })
  test('valid ids come back lower-cased and de-duplicated', () => {
    expect(validateProfileIds([U1, U2, U1, U2.toLowerCase()])).toEqual({ ok: true, ids: [U1, U2.toLowerCase()] })
  })
})

describe('validateTeamKeys', () => {
  test('absent → []; strings only; de-duplicated', () => {
    expect(validateTeamKeys(undefined)).toEqual({ ok: true, keys: [] })
    expect(validateTeamKeys(['xl', 'community', 'xl'])).toEqual({ ok: true, keys: ['xl', 'community'] })
    expect(validateTeamKeys('xl').ok).toBe(false)
    expect(validateTeamKeys([{ key: 'xl' }]).ok).toBe(false)
    expect(validateTeamKeys(['']).ok).toBe(false)
  })
})

describe('POSITION_CODES', () => {
  test('matches src/lib/constants.js POSITIONS', () => {
    expect([...POSITION_CODES]).toEqual([...POSITIONS])
  })
})

describe('validatePlayerBody', () => {
  const base = { email: ' jo@example.com ', password: 'longenough1', first_name: ' Jo ', last_name: 'Bloggs' }
  const now = new Date('2026-11-21T12:00:00Z')
  const run = (over = {}, opts = {}) => validatePlayerBody({ ...base, ...over }, { now, ...opts })
  const bad = (over, opts) => { const r = run(over, opts); expect(r.ok).toBe(false); return r.error }

  test('a minimal body passes, trimmed and normalised', () => {
    expect(run()).toEqual({ ok: true, value: {
      email: 'jo@example.com', password: 'longenough1', first_name: 'Jo', last_name: 'Bloggs',
      phone: null, positions: [], preferred: null, dob: null, is_player: true,
    } })
  })
  test('rejects a non-object body', () => {
    for (const b of [null, undefined, 'x', [], 5]) expect(validatePlayerBody(b).ok).toBe(false)
  })
  test('email: required, string, shape, <=254', () => {
    expect(bad({ email: undefined })).toMatch(/email/)
    expect(bad({ email: 42 })).toMatch(/email/)
    expect(bad({ email: 'not-an-email' })).toMatch(/email/)
    expect(bad({ email: 'a b@c.com' })).toMatch(/email/)
    expect(bad({ email: 'a'.repeat(250) + '@b.co' })).toMatch(/email/)
  })
  test('names: required, string, 1..60 after trim', () => {
    expect(bad({ first_name: '   ' })).toMatch(/first name/)
    expect(bad({ last_name: 7 })).toMatch(/surname/)
    expect(bad({ first_name: 'x'.repeat(61) })).toMatch(/too long/)
    expect(run({ first_name: 'x'.repeat(60) }).ok).toBe(true)
  })
  test('password: string, 10..72', () => {
    expect(bad({ password: 'short' })).toMatch(/at least 10/)
    expect(bad({ password: 12345678901 })).toMatch(/password/)
    expect(bad({ password: 'x'.repeat(73) })).toMatch(/too long/)
  })
  test('phone: optional, <=30, digits space + - ( ) only; can be required', () => {
    expect(run({ phone: '07700 900123' }).value.phone).toBe('07700 900123')
    expect(run({ phone: '+44 (0)7700-900123' }).ok).toBe(true)
    expect(run({ phone: '' }).value.phone).toBeNull()
    expect(bad({ phone: 'call me' })).toMatch(/phone/)
    expect(bad({ phone: '1'.repeat(31) })).toMatch(/phone/)
    expect(bad({ phone: 5 })).toMatch(/phone/)
    expect(bad({}, { requirePhone: true })).toMatch(/phone is required/)
    expect(run({ phone: '07700900123' }, { requirePhone: true }).ok).toBe(true)
  })
  test('positions: optional array of known codes', () => {
    expect(run({ positions: ['GK', 'ST', 'GK'] }).value.positions).toEqual(['GK', 'ST'])
    expect(bad({ positions: 'GK' })).toMatch(/positions/)
    expect(bad({ positions: ['GK', 'QB'] })).toMatch(/positions\[1\]/)
    expect(bad({ positions: [1] })).toMatch(/positions\[0\]/)
    expect(bad({ preferred: 'QB' })).toMatch(/preferred/)
    expect(run({ preferred: 'CB' }).value.preferred).toBe('CB')
  })
  test('dob: optional real date, not future, after 1900', () => {
    expect(run({ dob: '1990-05-17' }).value.dob).toBe('1990-05-17')
    expect(run({ dob: '' }).value.dob).toBeNull()
    expect(bad({ dob: '2026-11-22' })).toMatch(/future/)
    expect(run({ dob: '2026-11-21' }).ok).toBe(true)
    expect(bad({ dob: '1899-12-31' })).toMatch(/1900/)
    expect(bad({ dob: '2001-02-30' })).toMatch(/real date/)
    expect(bad({ dob: '17/05/1990' })).toMatch(/real date/)
    expect(bad({ dob: 19900517 })).toMatch(/real date/)
  })
  test('is_player: boolean if present, defaults true', () => {
    expect(run({ is_player: false }).value.is_player).toBe(false)
    expect(bad({ is_player: 'no' })).toMatch(/is_player/)
  })
})
