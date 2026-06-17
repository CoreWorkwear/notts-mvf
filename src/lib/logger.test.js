import { describe, test, expect } from 'vitest'
import { buildErrorRow, isActionableWindowError } from './logger'

describe('isActionableWindowError', () => {
  test('drops the opaque cross-origin "Script error." noise', () => {
    expect(isActionableWindowError({ message: 'Script error.', error: null })).toBe(false)
    expect(isActionableWindowError({ message: 'Script error', error: null })).toBe(false)
    expect(isActionableWindowError({ message: '', error: null })).toBe(false)
  })
  test('keeps a real same-origin error (has an Error object)', () => {
    expect(isActionableWindowError({ message: 'x is not a function', error: new Error('x is not a function') })).toBe(true)
  })
  test('keeps a detailed message even without an Error object', () => {
    expect(isActionableWindowError({ message: 'ResizeObserver loop limit exceeded' })).toBe(true)
  })
})

describe('buildErrorRow', () => {
  test('keeps the essentials and defaults kind', () => {
    const row = buildErrorRow({ message: 'boom', context: { a: 1 }, profileId: 'u1', url: '/fixtures', userAgent: 'UA' })
    expect(row).toMatchObject({ kind: 'error', message: 'boom', context: { a: 1 }, profile_id: 'u1', url: '/fixtures', user_agent: 'UA' })
  })

  test('truncates a runaway message', () => {
    expect(buildErrorRow({ kind: 'render', message: 'x'.repeat(5000) }).message).toHaveLength(1000)
  })

  test('survives a circular context instead of throwing', () => {
    const c = {}; c.self = c
    const row = buildErrorRow({ kind: 'render', message: 'm', context: c })
    expect(row.context).toEqual({ note: 'context unserialisable' })
  })

  test('null-safes optional fields', () => {
    const row = buildErrorRow({ message: undefined })
    expect(row.message).toBe('Unknown error')
    expect(row.context).toBeNull()
    expect(row.profile_id).toBeNull()
    expect(row.url).toBeNull()
  })
})
