import { describe, test, expect, vi } from 'vitest'

// push.js imports the supabase client (needs env); stub it for this unit test.
vi.mock('./supabase', () => ({ supabase: {} }))

import { urlBase64ToUint8Array } from './push'

describe('urlBase64ToUint8Array', () => {
  test('decodes standard base64 to the right bytes', () => {
    const out = urlBase64ToUint8Array('AQID') // -> [1,2,3]
    expect(out).toBeInstanceOf(Uint8Array)
    expect(Array.from(out)).toEqual([1, 2, 3])
  })
  test('handles url-safe chars (- _) and missing padding', () => {
    const out = urlBase64ToUint8Array('A-_-')
    expect(out).toBeInstanceOf(Uint8Array)
    expect(out.length).toBe(3)
  })
})
