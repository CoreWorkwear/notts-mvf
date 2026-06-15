import { describe, test, expect } from 'vitest'
import { FORMATIONS, FORMATION_NAMES, formationSlots, rowsToState, stateToRows, filledCount } from './lineup'

describe('formations', () => {
  test('every formation has exactly 11 outfield+GK slots', () => {
    for (const name of FORMATION_NAMES) {
      expect(formationSlots(name)).toHaveLength(11)
    }
  })
  test('slot 0 is always the keeper', () => {
    expect(formationSlots('4-3-3')[0]).toMatchObject({ slot: 0, pos: 'GK', line: 0 })
  })
  test('unknown formation falls back to the default', () => {
    expect(formationSlots('not-real')).toHaveLength(11)
  })
})

describe('rowsToState / stateToRows round-trip', () => {
  test('saved rows rebuild the editor state', () => {
    const rows = [
      { profile_id: 'gk', role: 'start', slot: 0, position: 'GK', formation: '4-4-2' },
      { profile_id: 'st', role: 'start', slot: 9, position: 'ST', formation: '4-4-2' },
      { profile_id: 'b1', role: 'sub', slot: null, formation: '4-4-2' },
    ]
    const s = rowsToState(rows)
    expect(s.formation).toBe('4-4-2')
    expect(s.starters[0]).toBe('gk')
    expect(s.starters[9]).toBe('st')
    expect(s.subs).toEqual(['b1'])
  })

  test('state persists only filled starting slots + subs, tagged with role/formation', () => {
    const rows = stateToRows('fix-1', { formation: '4-4-2', starters: { 0: 'gk', 1: 'lb' }, subs: ['s1', 's2'] })
    expect(rows).toHaveLength(4)
    expect(rows.find((r) => r.profile_id === 'gk')).toMatchObject({ role: 'start', position: 'GK', slot: 0, formation: '4-4-2', fixture_id: 'fix-1' })
    expect(rows.filter((r) => r.role === 'sub').map((r) => r.profile_id)).toEqual(['s1', 's2'])
  })

  test('empty slots are not persisted', () => {
    const rows = stateToRows('f', { formation: '4-4-2', starters: { 0: 'gk' }, subs: [] })
    expect(rows).toHaveLength(1)
  })
})

describe('filledCount', () => {
  test('counts assigned starters only', () => {
    expect(filledCount({ 0: 'a', 1: 'b', 2: null })).toBe(2)
    expect(filledCount({})).toBe(0)
  })
})
