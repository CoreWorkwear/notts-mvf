import { describe, test, expect } from 'vitest'
import { squadFull, canRegister, squadCountLabel } from './squad'

describe('squad cap helpers', () => {
  test('unlimited (no cap) is never full', () => {
    expect(squadFull({ count: 99, enabled: false, limit: null })).toBe(false)
    expect(squadFull({ count: 99, enabled: true, limit: null })).toBe(false)
    expect(canRegister({ count: 99, enabled: false })).toBe(true)
  })
  test('capped: full at the limit, room below it', () => {
    expect(squadFull({ count: 16, enabled: true, limit: 16 })).toBe(true)
    expect(squadFull({ count: 15, enabled: true, limit: 16 })).toBe(false)
    expect(canRegister({ count: 16, enabled: true, limit: 16 })).toBe(false)
    expect(canRegister({ count: 15, enabled: true, limit: 16 })).toBe(true)
  })
  test('label reflects cap on/off', () => {
    expect(squadCountLabel({ count: 14, enabled: true, limit: 16 })).toBe('14 / 16 registered')
    expect(squadCountLabel({ count: 14, enabled: false, limit: null })).toBe('14 registered')
  })
})
