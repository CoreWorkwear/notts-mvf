import { describe, test, expect } from 'vitest'
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
