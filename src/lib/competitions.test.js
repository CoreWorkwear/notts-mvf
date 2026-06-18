import { describe, test, expect } from 'vitest'
import { validateCompetition, competitionPayload, squadRuleSummary, competitionTypeLabel } from './competitions'

describe('validateCompetition', () => {
  test('requires a name', () => {
    expect(validateCompetition({ name: ' ' })).toMatch(/name/i)
    expect(validateCompetition({ name: 'County Cup' })).toBeNull()
  })
  test('requires a size when the limit is on', () => {
    expect(validateCompetition({ name: 'X', squad_limit_enabled: true })).toMatch(/squad size/i)
    expect(validateCompetition({ name: 'X', squad_limit_enabled: true, squad_limit: 0 })).toMatch(/squad size/i)
    expect(validateCompetition({ name: 'X', squad_limit_enabled: true, squad_limit: 16 })).toBeNull()
  })
})

describe('competitionPayload', () => {
  test('a disabled limit forces size to null (unlimited)', () => {
    expect(competitionPayload({ name: ' Sunday League ', type: 'league', squad_limit_enabled: false, squad_limit: 16 }))
      .toEqual({ name: 'Sunday League', type: 'league', squad_limit_enabled: false, squad_limit: null })
  })
  test('an enabled limit stores the size', () => {
    expect(competitionPayload({ name: 'County Cup', type: 'cup', squad_limit_enabled: true, squad_limit: '16' }))
      .toEqual({ name: 'County Cup', type: 'cup', squad_limit_enabled: true, squad_limit: 16 })
  })
  test('defaults the type to league', () => {
    expect(competitionPayload({ name: 'X' }).type).toBe('league')
  })
})

describe('squadRuleSummary / typeLabel', () => {
  test('summarises the rule', () => {
    expect(squadRuleSummary({ squad_limit_enabled: false })).toMatch(/no squad limit/i)
    expect(squadRuleSummary({ squad_limit_enabled: true, squad_limit: 14 })).toBe('14-player squad')
  })
  test('labels types', () => {
    expect(competitionTypeLabel('cup')).toBe('Cup')
    expect(competitionTypeLabel('friendly_series')).toBe('Friendlies')
    expect(competitionTypeLabel('nope')).toBe('Other')
  })
})
