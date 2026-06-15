import { describe, test, expect } from 'vitest'
import { hoursUntil, dueOffsets, offsetLabel } from './reminders'

describe('hoursUntil', () => {
  test('positive before kickoff, negative after', () => {
    expect(hoursUntil(10 * 3_600_000, 0)).toBe(10)
    expect(hoursUntil(0, 5 * 3_600_000)).toBe(-5)
  })
})

describe('dueOffsets', () => {
  const offsets = [48, 24]

  test('nothing due when kickoff is far away', () => {
    expect(dueOffsets({ hoursToKO: 100, offsets, sent: [] })).toEqual([])
  })
  test('the 48h reminder fires once the window arrives', () => {
    expect(dueOffsets({ hoursToKO: 47, offsets, sent: [] })).toEqual([48])
  })
  test('the 24h reminder fires later, with the 48h already sent', () => {
    expect(dueOffsets({ hoursToKO: 23, offsets, sent: [48] })).toEqual([24])
  })
  test('an already-sent offset is never returned again', () => {
    expect(dueOffsets({ hoursToKO: 23, offsets, sent: [48, 24] })).toEqual([])
  })
  test('a fixture added late (inside several windows) returns all unsent — caller sends one, records all', () => {
    expect(dueOffsets({ hoursToKO: 10, offsets, sent: [] })).toEqual([24, 48])
  })
  test('never reminds for a kicked-off fixture', () => {
    expect(dueOffsets({ hoursToKO: 0, offsets, sent: [] })).toEqual([])
    expect(dueOffsets({ hoursToKO: -3, offsets, sent: [] })).toEqual([])
  })
  test('handles missing offsets/sent safely', () => {
    expect(dueOffsets({ hoursToKO: 10 })).toEqual([])
  })
})

describe('offsetLabel', () => {
  test('friendly labels for known offsets, fallback otherwise', () => {
    expect(offsetLabel(24)).toBe('1 day')
    expect(offsetLabel(6)).toBe('6 hours')
    expect(offsetLabel(99)).toBe('99h')
  })
})
