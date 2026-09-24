import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'

const sb = await vi.hoisted(async () => (await import('../test/supabaseMock')).makeSupabaseMock())
const refreshProfile = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../lib/supabase', () => ({ supabase: sb.client }))
vi.mock('../lib/logger', () => ({ logError: vi.fn() }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ profile: { club_id: 'c1' }, user: { id: 'u1' }, refreshProfile }) }))

import { useMedia } from './useMedia'

beforeEach(() => {
  refreshProfile.mockClear()
  sb.reset({ media_assets: [{ id: 'm1', url: 'https://cdn/a.jpg', created_at: '2026-01-01T00:00:00Z' }], clubs: [] })
})

// The write helpers THREW, and MediaPanel called them un-awaited — so a failed
// media_assets insert was an unhandled rejection with no UI feedback, and the
// photo sat orphaned in the bucket.
describe('useMedia — writes resolve { error } instead of rejecting', () => {
  test('addPhoto resolves { error } when the insert fails', async () => {
    const { result } = renderHook(() => useMedia())
    await waitFor(() => expect(result.current.loading).toBe(false))

    sb.failWith('media_assets', { message: 'RLS said no', code: '42501' })
    await expect(result.current.addPhoto('https://cdn/new.jpg')).resolves.toEqual({ error: expect.objectContaining({ message: 'RLS said no' }) })
  })

  test('removePhoto resolves { error } when the delete fails', async () => {
    const { result } = renderHook(() => useMedia())
    await waitFor(() => expect(result.current.loading).toBe(false))

    sb.failWith('media_assets', { message: 'nope' })
    await expect(result.current.removePhoto('m1')).resolves.toEqual({ error: expect.objectContaining({ message: 'nope' }) })
  })

  test('setCrest resolves { error } when the club update fails (and does not refresh the profile)', async () => {
    const { result } = renderHook(() => useMedia())
    await waitFor(() => expect(result.current.loading).toBe(false))

    sb.failWith('clubs', { message: 'nope' })
    await expect(result.current.setCrest('https://cdn/crest.png')).resolves.toEqual({ error: expect.objectContaining({ message: 'nope' }) })
    expect(refreshProfile).not.toHaveBeenCalled()
  })

  test('a successful addPhoto resolves { error: null } and refetches the pool', async () => {
    const { result } = renderHook(() => useMedia())
    await waitFor(() => expect(result.current.loading).toBe(false))

    let res
    await act(async () => { res = await result.current.addPhoto('https://cdn/new.jpg') }) // load() sets state
    expect(res).toEqual({ error: null })
    const ins = sb.writes.find((w) => w.table === 'media_assets' && w.op === 'insert')
    expect(ins.payload).toMatchObject({ club_id: 'c1', type: 'photo', url: 'https://cdn/new.jpg', uploaded_by: 'u1' })
  })
})
