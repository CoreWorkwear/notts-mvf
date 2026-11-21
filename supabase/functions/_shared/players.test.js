import { describe, test, expect, vi } from 'vitest'
import { decideDeleteTarget, mapDeleteRpcError, removeLoginOrBlock, mapCreateUserError, profileInCallerClub, DELETE_ADMIN_MESSAGE } from './players.js'

describe('decideDeleteTarget', () => {
  test('refuses deleting yourself (400)', () => {
    expect(decideDeleteTarget({ callerId: 'a', targetId: 'a', targetRole: 'admin' })).toMatchObject({ ok: false, status: 400 })
  })
  test('refuses another manager (403) with the take-the-role-off message', () => {
    expect(decideDeleteTarget({ callerId: 'a', targetId: 'b', targetRole: 'admin' }))
      .toEqual({ ok: false, status: 403, error: DELETE_ADMIN_MESSAGE })
    expect(DELETE_ADMIN_MESSAGE).toBe("Managers can't be deleted here. Take their manager role off first.")
  })
  test('allows a player, and a missing row (the RPC then answers 404)', () => {
    expect(decideDeleteTarget({ callerId: 'a', targetId: 'b', targetRole: 'player' })).toEqual({ ok: true })
    expect(decideDeleteTarget({ callerId: 'a', targetId: 'b', targetRole: null })).toEqual({ ok: true })
  })
})

describe('mapDeleteRpcError', () => {
  test('known codes get friendly lines; anything else is null (generic 500)', () => {
    expect(mapDeleteRpcError({ code: '42501', message: 'raw' })).toMatchObject({ status: 403 })
    expect(mapDeleteRpcError({ code: 'P0002', message: 'raw' })).toMatchObject({ status: 404 })
    expect(mapDeleteRpcError({ code: '23503', message: 'raw fk detail' })).toBeNull()
    expect(mapDeleteRpcError({ code: '42501', message: 'raw' }).error).not.toContain('raw')
  })
})

describe('removeLoginOrBlock', () => {
  test('deleted first time: no retry, no ban', async () => {
    const deleteUser = vi.fn(async () => ({ error: null }))
    const banUser = vi.fn()
    expect(await removeLoginOrBlock({ deleteUser, banUser })).toEqual({ ok: true })
    expect(deleteUser).toHaveBeenCalledTimes(1)
    expect(banUser).not.toHaveBeenCalled()
  })
  test('retries once and succeeds without banning', async () => {
    const deleteUser = vi.fn().mockResolvedValueOnce({ error: { message: 'blip' } }).mockResolvedValueOnce({ error: null })
    const banUser = vi.fn()
    expect(await removeLoginOrBlock({ deleteUser, banUser })).toEqual({ ok: true, retried: true })
    expect(banUser).not.toHaveBeenCalled()
  })
  test('still failing after the retry: bans the login and says so', async () => {
    const deleteUser = vi.fn(async () => ({ error: { message: 'down', code: 'unexpected_failure' } }))
    const banUser = vi.fn(async () => ({ error: null }))
    const r = await removeLoginOrBlock({ deleteUser, banUser })
    expect(deleteUser).toHaveBeenCalledTimes(2)
    expect(banUser).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ ok: false, banned: true, status: 500 })
    expect(r.error).toMatch(/profile is removed/i)
    expect(r.error).toMatch(/blocked/i)
    expect(r.error).not.toContain('down')
  })
  test('ban fails too (or throws): says the login could not be blocked either', async () => {
    const deleteUser = vi.fn(async () => { throw new Error('boom') })
    const banUser = vi.fn(async () => ({ error: { message: 'nope' } }))
    const r = await removeLoginOrBlock({ deleteUser, banUser })
    expect(r).toMatchObject({ ok: false, banned: false, status: 500 })
    expect(r.error).toMatch(/could not be deleted or blocked/i)
  })
})

describe('mapCreateUserError', () => {
  test('duplicate and weak-password get friendly 400s; unknown is null', () => {
    expect(mapCreateUserError({ code: 'email_exists' })).toMatchObject({ status: 400 })
    expect(mapCreateUserError({ message: 'A user with this email address has already been registered' })).toMatchObject({ status: 400 })
    expect(mapCreateUserError({ code: 'weak_password' })).toMatchObject({ status: 400 })
    expect(mapCreateUserError({ code: 'unexpected_failure', message: 'db exploded' })).toBeNull()
  })
})

describe('profileInCallerClub', () => {
  test('only a successful read of the same club passes', () => {
    expect(profileInCallerClub({ made: { club_id: 'c1' }, madeErr: null, callerClub: 'c1' })).toBe(true)
    expect(profileInCallerClub({ made: { club_id: 'c2' }, madeErr: null, callerClub: 'c1' })).toBe(false)
    expect(profileInCallerClub({ made: null, madeErr: null, callerClub: 'c1' })).toBe(false)
    expect(profileInCallerClub({ made: { club_id: 'c1' }, madeErr: { code: 'x' }, callerClub: 'c1' })).toBe(false)
    expect(profileInCallerClub({ made: { club_id: null }, madeErr: null, callerClub: null })).toBe(false)
  })
})
