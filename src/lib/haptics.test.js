import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { haptic, PATTERNS, hapticsAvailable, hapticsEnabled, setHapticsEnabled } from './haptics'

// Haptics are decorative by contract: iOS Safari has never implemented the
// Vibration API, so roughly half the squad feels none of this. Everything here
// is about the module staying silent and harmless rather than about buzzing.

const withVibrate = (impl) => { navigator.vibrate = impl }

beforeEach(() => {
  window.localStorage.clear()
  withVibrate(vi.fn(() => true))
})
afterEach(() => { delete navigator.vibrate })

describe('haptic', () => {
  test('fires the named pattern', () => {
    expect(haptic('confirm')).toBe(true)
    expect(navigator.vibrate).toHaveBeenCalledWith(PATTERNS.confirm)
  })

  test('an unknown name is ignored rather than guessed at', () => {
    expect(haptic('nope')).toBe(false)
    expect(navigator.vibrate).not.toHaveBeenCalled()
  })

  // The iOS case, and the whole reason nothing may depend on this.
  test('a device with no Vibration API is a silent no-op, not a crash', () => {
    delete navigator.vibrate
    expect(() => haptic('tap')).not.toThrow()
    expect(haptic('tap')).toBe(false)
  })

  // Some builds refuse vibrate() outside a user gesture by throwing.
  test('a throwing vibrate never escapes', () => {
    withVibrate(() => { throw new Error('requires a user gesture') })
    expect(() => haptic('tap')).not.toThrow()
    expect(haptic('tap')).toBe(false)
  })

  test('respects the opt-out', () => {
    setHapticsEnabled(false)
    expect(hapticsEnabled()).toBe(false)
    expect(haptic('confirm')).toBe(false)
    expect(navigator.vibrate).not.toHaveBeenCalled()

    setHapticsEnabled(true)
    expect(haptic('confirm')).toBe(true)
  })
})

describe('preference storage', () => {
  // Private mode, or blocked site data. A buzz preference must never be able to
  // take the app down, and a device that cannot remember it still works.
  test('unreadable storage reads as enabled rather than throwing', () => {
    const spy = vi.spyOn(window.localStorage.__proto__, 'getItem')
      .mockImplementation(() => { throw new Error('SecurityError') })
    expect(() => hapticsEnabled()).not.toThrow()
    expect(hapticsEnabled()).toBe(true)
    spy.mockRestore()
  })

  test('unwritable storage does not throw', () => {
    const spy = vi.spyOn(window.localStorage.__proto__, 'setItem')
      .mockImplementation(() => { throw new Error('QuotaExceededError') })
    expect(() => setHapticsEnabled(false)).not.toThrow()
    spy.mockRestore()
  })
})

describe('hapticsAvailable', () => {
  test('gates whether the toggle is worth showing at all', () => {
    expect(hapticsAvailable()).toBe(true)
    delete navigator.vibrate
    expect(hapticsAvailable()).toBe(false)
  })
})

describe('the vocabulary', () => {
  // Named patterns exist so "confirming something" feels the same everywhere and
  // can be retuned in one place. Durations stay short on purpose: an app that
  // buzzes like a notification every time you touch it is worse than silence.
  test('every pattern is short enough not to read as a notification', () => {
    const total = (p) => (Array.isArray(p) ? p.reduce((a, b) => a + b, 0) : p)
    for (const [name, pattern] of Object.entries(PATTERNS)) {
      expect(total(pattern), `${name} is too long`).toBeLessThanOrEqual(120)
    }
  })
})
