import { describe, test, expect } from 'vitest'
import { validateSeason } from './seasons'

describe('validateSeason', () => {
  test('requires a label', () => {
    expect(validateSeason({ label: '' })).toMatch(/label/i)
    expect(validateSeason({ label: '  ' })).toMatch(/label/i)
  })
  test('end date must be after start date', () => {
    expect(validateSeason({ label: '2026/27', start_date: '2026-08-01', end_date: '2026-05-01' })).toMatch(/after/i)
  })
  test('passes a valid season (dates optional)', () => {
    expect(validateSeason({ label: '2026/27' })).toBeNull()
    expect(validateSeason({ label: '2026/27', start_date: '2026-08-01', end_date: '2027-05-31' })).toBeNull()
  })
})
