import { describe, test, expect } from 'vitest'
import { hoursUntil, dueOffsets, offsetLabel, OFFSET_CHOICES, availabilityReminderTargets, matchReminderTargets } from './reminders'

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

describe('OFFSET_CHOICES — the exact periods the club asked for', () => {
  test('is precisely 2 weeks / 1 week / 5 / 4 / 3 / 2 / 1 day, in that order', () => {
    expect(OFFSET_CHOICES.map((c) => c.hours)).toEqual([336, 168, 120, 96, 72, 48, 24])
    expect(OFFSET_CHOICES.map((c) => c.label)).toEqual(['2 weeks', '1 week', '5 days', '4 days', '3 days', '2 days', '1 day'])
  })
})

describe('availabilityReminderTargets — undecided only (not replied + maybe)', () => {
  const roster = ['a', 'b', 'c', 'd', 'e']
  test('keeps not-replied and maybe, drops in and out', () => {
    const statusById = { a: 'in', b: 'out', c: 'maybe' /* d, e not replied */ }
    expect(availabilityReminderTargets(roster, statusById).sort()).toEqual(['c', 'd', 'e'])
  })
  test('empty roster is safe', () => {
    expect(availabilityReminderTargets([], {})).toEqual([])
  })
})

describe('matchReminderTargets — in + maybe only', () => {
  test('keeps in and maybe, drops out', () => {
    expect(matchReminderTargets({ a: 'in', b: 'maybe', c: 'out' }).sort()).toEqual(['a', 'b'])
  })
})

describe('offsetLabel', () => {
  test('friendly day-based labels for known offsets, fallback otherwise', () => {
    expect(offsetLabel(336)).toBe('2 weeks')
    expect(offsetLabel(168)).toBe('1 week')
    expect(offsetLabel(72)).toBe('3 days')
    expect(offsetLabel(24)).toBe('1 day')
    expect(offsetLabel(6)).toBe('6h') // not a standard choice → fallback
  })
})
