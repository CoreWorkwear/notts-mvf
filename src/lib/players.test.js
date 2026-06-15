import { describe, test, expect } from 'vitest'
import { validatePlayer, diffMemberships, isSelf, isSquadMember, canSetAvailability, accountStatus } from './players'

const ok = { first_name: 'Joe', last_name: 'Morris', email: 'joe@notts.test', phone: '07700900000' }

describe('validatePlayer', () => {
  test('passes a complete record', () => {
    expect(validatePlayer(ok)).toBeNull()
  })
  test('flags each missing required field', () => {
    expect(validatePlayer({ ...ok, first_name: ' ' })).toMatch(/first name/i)
    expect(validatePlayer({ ...ok, last_name: '' })).toMatch(/surname/i)
    expect(validatePlayer({ ...ok, phone: '' })).toMatch(/phone/i)
  })
  test('rejects a malformed email', () => {
    expect(validatePlayer({ ...ok, email: 'not-an-email' })).toMatch(/email/i)
  })
  test('requires a 6+ char starter password only when adding', () => {
    expect(validatePlayer(ok, { needPassword: true, password: '123' })).toMatch(/password/i)
    expect(validatePlayer(ok, { needPassword: true, password: 'goodpass' })).toBeNull()
    expect(validatePlayer(ok, { needPassword: false })).toBeNull()
  })
})

describe('diffMemberships', () => {
  const teams = [{ id: 't-xl', key: 'xl' }, { id: 't-co', key: 'community' }]
  test('adds newly-ticked teams', () => {
    expect(diffMemberships([], ['xl'], teams)).toEqual({ toAdd: ['t-xl'], toRemove: [] })
  })
  test('removes unticked teams', () => {
    expect(diffMemberships(['t-xl', 't-co'], ['community'], teams)).toEqual({ toAdd: [], toRemove: ['t-xl'] })
  })
  test('no change when selection matches', () => {
    expect(diffMemberships(['t-co'], ['community'], teams)).toEqual({ toAdd: [], toRemove: [] })
  })
})

describe('isSelf', () => {
  test('true only for the admin\'s own row', () => {
    expect(isSelf({ id: 'u1' }, 'u1')).toBe(true)
    expect(isSelf({ id: 'u2' }, 'u1')).toBe(false)
    expect(isSelf(null, 'u1')).toBe(false)
  })
})

describe('isSquadMember / canSetAvailability (approval gate)', () => {
  const active = { active: true, approved: true, is_player: true }
  test('an approved, active player is a squad member who can respond', () => {
    expect(isSquadMember(active)).toBe(true)
    expect(canSetAvailability(active)).toBe(true)
  })
  test('a pending player can view but not act', () => {
    expect(isSquadMember({ ...active, approved: false })).toBe(false)
    expect(canSetAvailability({ ...active, approved: false })).toBe(false)
  })
  test('a supporter is never a squad member', () => {
    expect(isSquadMember({ ...active, is_player: false })).toBe(false)
    expect(canSetAvailability({ ...active, is_player: false })).toBe(false)
  })
  test('an inactive (removed) player is excluded', () => {
    expect(isSquadMember({ ...active, active: false })).toBe(false)
  })
  test('null/undefined profile is safe', () => {
    expect(isSquadMember(null)).toBe(false)
    expect(canSetAvailability(undefined)).toBe(false)
  })
})

describe('accountStatus', () => {
  test('classifies each account state', () => {
    expect(accountStatus({ is_player: true, active: true, approved: true })).toBe('active')
    expect(accountStatus({ is_player: true, active: true, approved: false })).toBe('pending')
    expect(accountStatus({ is_player: false, active: true, approved: true })).toBe('supporter')
    expect(accountStatus({ is_player: true, active: false, approved: true })).toBe('inactive')
    // supporter takes precedence over pending/inactive
    expect(accountStatus({ is_player: false, active: false, approved: false })).toBe('supporter')
  })
})
