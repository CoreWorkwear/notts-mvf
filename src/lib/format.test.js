import { describe, test, expect, vi, afterEach } from 'vitest'
import { hasKickedOff, fixtureConcluded, todayISO, relativeWhen, parseDate, fmtDate, fmtKO } from './format'

// The match lifecycle keystone. Fixtures store a London wall-clock date +
// kickoff; "now" must be read in London too, so GMT↔BST is right without any
// manual offset maths. These pin that contract across both clock changes.
afterEach(() => vi.useRealTimers())

describe('hasKickedOff / fixtureConcluded — reckoned in Europe/London', () => {
  test('BST starts (2026-03-29 01:00Z): 02:00 kickoff is in the future at 00:30Z and in the past at 01:30Z', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-29T00:30:00Z')) // London 00:30 GMT
    expect(hasKickedOff('2026-03-29', '02:00')).toBe(false)
    vi.setSystemTime(new Date('2026-03-29T01:30:00Z')) // London 02:30 BST (clocks jumped 01:00 → 02:00)
    expect(hasKickedOff('2026-03-29', '02:00')).toBe(true)
  })

  test('GMT returns (2026-10-25 01:00Z): a 21:00 game the night before concludes at 01:00 nominal', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-25T00:30:00Z')) // London 01:30 BST (before the fall-back)
    expect(fixtureConcluded('2026-10-24', '21:00')).toBe(true)
    vi.setSystemTime(new Date('2026-10-24T23:30:00Z')) // London 00:30 BST
    expect(fixtureConcluded('2026-10-24', '21:00')).toBe(false)
  })

  test('summer: a 14:00 BST kickoff is 13:00Z — device clocks abroad make no difference', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-05T12:59:00Z')) // London 13:59 BST
    expect(hasKickedOff('2026-07-05', '14:00:00')).toBe(false)
    vi.setSystemTime(new Date('2026-07-05T13:00:00Z')) // London 14:00 BST
    expect(hasKickedOff('2026-07-05', '14:00:00')).toBe(true)
    expect(fixtureConcluded('2026-07-05', '14:00:00')).toBe(false)
    vi.setSystemTime(new Date('2026-07-05T17:00:00Z')) // 18:00 BST = KO + 4h
    expect(fixtureConcluded('2026-07-05', '14:00:00')).toBe(true)
  })

  test('a missing kickoff is treated as midnight', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-10T00:00:00Z'))
    expect(hasKickedOff('2026-01-10', null)).toBe(true)
    expect(hasKickedOff('2026-01-11', null)).toBe(false)
  })
})

describe('todayISO / relativeWhen — "today" is London today, not the device', () => {
  test('todayISO(now) reads the London date: 23:30Z on 1 July is already 2 July BST', () => {
    expect(todayISO(new Date('2026-07-01T23:30:00Z'))).toBe('2026-07-02')
    expect(todayISO(new Date('2026-12-01T23:30:00Z'))).toBe('2026-12-01')
  })

  test('relativeWhen agrees with the same clock', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T23:30:00Z')) // London: 2 July
    expect(relativeWhen('2026-07-02')).toBe('today')
    expect(relativeWhen('2026-07-03')).toBe('tomorrow')
    expect(relativeWhen('2026-07-01')).toBe('yesterday')
    expect(relativeWhen('2026-07-09')).toBe('in 7 days')
    expect(relativeWhen('2026-06-25')).toBe('7 days ago')
  })
})

describe('parsing + formatting', () => {
  test('parseDate keeps the calendar day (no UTC shift) and fmtDate reads the UK way', () => {
    const d = parseDate('2026-03-08')
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 2, 8])
    expect(fmtDate('2026-03-08')).toBe('Sun 8 Mar')
  })
  test('fmtKO trims seconds and tolerates null', () => {
    expect(fmtKO('13:00:00')).toBe('13:00')
    expect(fmtKO(null)).toBe('')
  })
})
