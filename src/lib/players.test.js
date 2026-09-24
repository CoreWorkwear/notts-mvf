import { describe, test, expect } from 'vitest'
import { validatePlayer, diffMemberships, isSelf, isSquadMember, canSetAvailability, accountStatus, respondBlock, respondBlockCopy } from './players'

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

// --- the team-scoped availability gate (bug: Community players could answer
// First Team games; migration 0034) -----------------------------------------
const XL = 't-xl'
const COMM = 't-comm'
const squadPlayer = { is_player: true, active: true, approved: true }
const xlGame = { team_id: XL, match_date: '2030-12-01', kickoff: '13:00:00', team: { key: 'xl', label: 'First Team' } }
const commGame = { team_id: COMM, match_date: '2030-12-01', kickoff: '11:00:00', team: { key: 'community', label: 'Community' } }
const playedGame = { ...commGame, match_date: '2020-01-05' }

describe('respondBlock', () => {
  test('a Community-only player cannot answer a First Team game', () => {
    expect(respondBlock(squadPlayer, [COMM], xlGame)).toBe('other-team')
  })

  test('but answers their own squad game fine', () => {
    expect(respondBlock(squadPlayer, [COMM], commGame)).toBeNull()
  })

  test('a player in both squads answers either', () => {
    expect(respondBlock(squadPlayer, [COMM, XL], xlGame)).toBeNull()
    expect(respondBlock(squadPlayer, [COMM, XL], commGame)).toBeNull()
  })

  test('a First-Team-only player cannot answer a Community game (the gate cuts both ways)', () => {
    expect(respondBlock(squadPlayer, [XL], commGame)).toBe('other-team')
  })

  test('nobody answers a game that has kicked off', () => {
    expect(respondBlock(squadPlayer, [COMM], playedGame)).toBe('kicked-off')
  })

  test('the squad check comes first — a non-member gets the squad reason, not the kickoff one', () => {
    expect(respondBlock(squadPlayer, [XL], playedGame)).toBe('other-team')
  })

  test('account state still leads: a pending or supporter account is blocked on their own squad', () => {
    expect(respondBlock({ ...squadPlayer, approved: false }, [COMM], commGame)).toBe('pending')
    expect(respondBlock({ ...squadPlayer, is_player: false }, [COMM], commGame)).toBe('supporter')
    expect(respondBlock({ ...squadPlayer, active: false }, [COMM], commGame)).toBe('inactive')
  })

  test('fails CLOSED on anything it cannot resolve', () => {
    expect(respondBlock(null, [COMM], commGame)).toBe('unknown')          // profile not loaded
    expect(respondBlock(squadPlayer, [COMM], null)).toBe('unknown')       // no fixture
    expect(respondBlock(squadPlayer, [COMM], { match_date: '2030-12-01' })).toBe('unknown') // no team on the fixture
    expect(respondBlock(squadPlayer, null, commGame)).toBe('unknown')     // squads not loaded yet
    expect(respondBlock(squadPlayer, [], commGame)).toBe('other-team')    // loaded, genuinely in no squad
  })
})

describe('respondBlockCopy', () => {
  test('names the squad that actually plays the game', () => {
    expect(respondBlockCopy('other-team', xlGame)).toMatch(/First Team squad only/)
    expect(respondBlockCopy('other-team', commGame)).toMatch(/Community squad only/)
  })

  test('has a short form for a list row', () => {
    expect(respondBlockCopy('other-team', xlGame, { compact: true })).toBe('First Team squad only')
  })

  test('says something sensible for every reason, and never blows up without a fixture', () => {
    for (const r of ['supporter', 'pending', 'inactive', 'other-team', 'kicked-off', 'unknown']) {
      expect(respondBlockCopy(r, null).length).toBeGreaterThan(0)
    }
  })
})
