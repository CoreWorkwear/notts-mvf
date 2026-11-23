import { describe, test, expect, vi } from 'vitest'
import { timingSafeEqualStrings, requireActiveAdmin } from './auth.js'

describe('timingSafeEqualStrings', () => {
  test('equal strings match; any difference, length change or non-string does not', async () => {
    expect(await timingSafeEqualStrings('s3cret-value', 's3cret-value')).toBe(true)
    expect(await timingSafeEqualStrings('s3cret-value', 's3cret-valuf')).toBe(false)
    expect(await timingSafeEqualStrings('s3cret', 's3cret-value')).toBe(false)
    expect(await timingSafeEqualStrings('', 'x')).toBe(false)
    expect(await timingSafeEqualStrings('', '')).toBe(true)
    expect(await timingSafeEqualStrings(null, 'x')).toBe(false)
    expect(await timingSafeEqualStrings('x', undefined)).toBe(false)
  })
})

const okUser = { data: { user: { id: 'u1' } }, error: null }
const admin = { data: { role: 'admin', active: true, club_id: 'c1' }, error: null }

describe('requireActiveAdmin', () => {
  test('401 when the token gives no user (and the profile is never read)', async () => {
    const loadProfile = vi.fn()
    for (const got of [{ data: { user: null }, error: null }, { data: { user: null }, error: { message: 'bad jwt' } }, { data: null, error: null }]) {
      const r = await requireActiveAdmin({ getUser: async () => got, loadProfile })
      expect(r).toMatchObject({ ok: false, status: 401, error: 'unauthorized' })
    }
    expect(loadProfile).not.toHaveBeenCalled()
  })
  test('403 for a player, an inactive manager, a missing row, or a failed read', async () => {
    const cases = [
      { data: { role: 'player', active: true }, error: null },
      { data: { role: 'admin', active: false }, error: null },
      { data: { role: 'admin', active: null }, error: null },
      { data: null, error: null },
      { data: null, error: { code: 'PGRST116' } },
      { data: { role: 'admin', active: true }, error: { code: 'X' } },
    ]
    for (const c of cases) {
      const r = await requireActiveAdmin({ getUser: async () => okUser, loadProfile: async () => c })
      expect(r).toMatchObject({ ok: false, status: 403, error: 'forbidden', user: { id: 'u1' } })
    }
  })
  test('403 carries the db error code for the log', async () => {
    const r = await requireActiveAdmin({ getUser: async () => okUser, loadProfile: async () => ({ data: null, error: { code: 'PGRST116' } }) })
    expect(r.code).toBe('PGRST116')
  })
  test('an active admin passes with user and profile', async () => {
    const loadProfile = vi.fn(async () => admin)
    const r = await requireActiveAdmin({ getUser: async () => okUser, loadProfile })
    expect(r).toEqual({ ok: true, user: { id: 'u1' }, me: admin.data })
    expect(loadProfile).toHaveBeenCalledWith('u1')
  })
})
