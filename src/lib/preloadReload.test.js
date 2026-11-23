import { describe, test, expect, vi } from 'vitest'
import { reloadOnceOnPreloadError, clearPreloadReloadFlag, PRELOAD_RELOAD_KEY } from './preloadReload'

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m } }
const ev = () => ({ payload: new Error('Failed to fetch dynamically imported module'), preventDefault: vi.fn() })

describe('reloadOnceOnPreloadError', () => {
  test('first failure reloads, logs, and sets the guard', () => {
    const storage = mem(); const reload = vi.fn(); const log = vi.fn(); const e = ev()
    expect(reloadOnceOnPreloadError(e, { storage, reload, log })).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('fetch', e.payload, expect.objectContaining({ op: 'preloadError' }))
    expect(e.preventDefault).toHaveBeenCalled()
    expect(storage.getItem(PRELOAD_RELOAD_KEY)).toBe('1')
  })

  test('a second failure does NOT reload again (no loop)', () => {
    const storage = mem(); const reload = vi.fn(); const log = vi.fn()
    reloadOnceOnPreloadError(ev(), { storage, reload, log })
    expect(reloadOnceOnPreloadError(ev(), { storage, reload, log })).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledTimes(2)
  })

  test('throwing storage never reloads and never throws', () => {
    const bad = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
    const reload = vi.fn()
    expect(() => reloadOnceOnPreloadError(ev(), { storage: bad, reload, log: vi.fn() })).not.toThrow()
    expect(reload).not.toHaveBeenCalled()
    const readOnly = { getItem: () => null, setItem() { throw new Error('quota') } }
    expect(reloadOnceOnPreloadError(ev(), { storage: readOnly, reload, log: vi.fn() })).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  test('clearing the flag lets a later deploy reload once more', () => {
    const storage = mem(); const reload = vi.fn()
    reloadOnceOnPreloadError(ev(), { storage, reload, log: vi.fn() })
    clearPreloadReloadFlag(storage)
    expect(reloadOnceOnPreloadError(ev(), { storage, reload, log: vi.fn() })).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })
})
