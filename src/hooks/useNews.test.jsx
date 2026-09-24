import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'

const sb = await vi.hoisted(async () => (await import('../test/supabaseMock')).makeSupabaseMock())
const logError = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase', () => ({ supabase: sb.client }))
vi.mock('../lib/logger', () => ({ logError }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ profile: { club_id: 'c1' }, user: { id: 'u1' } }) }))

import { useNews } from './useNews'

beforeEach(() => {
  logError.mockClear()
  sb.reset({ announcements: [{ id: 'a1', title: 'Pitch change', body: 'On the 4G', pushed: false, created_at: '2026-01-01T00:00:00Z', author: null }] })
  sb.client.functions.invoke.mockReset()
})

// The post used to be inserted with pushed:true BEFORE the push was attempted,
// and functions.invoke resolves { error } rather than throwing — so a failed
// push still showed the 🔔 "pushed to phones" badge and nobody was told.
describe('useNews.post — the pushed flag tells the truth', () => {
  test('a failed push never writes pushed:true, is logged, and is reported to the composer', async () => {
    sb.client.functions.invoke.mockResolvedValue({ data: null, error: { message: 'send-push blew up', status: 500 } })
    const { result } = renderHook(() => useNews())
    await waitFor(() => expect(result.current.loading).toBe(false))

    let res
    await act(async () => { res = await result.current.post({ title: ' Pitch change ', body: ' On the 4G ', push: true }) })

    expect(sb.client.functions.invoke).toHaveBeenCalledWith('send-push', expect.objectContaining({ body: expect.objectContaining({ title: 'Pitch change', body: 'On the 4G' }) }))
    const pushedTrue = sb.writes.filter((w) => w.table === 'announcements' && w.payload?.pushed === true)
    expect(pushedTrue).toEqual([])
    expect(logError).toHaveBeenCalledWith('push', expect.objectContaining({ message: 'send-push blew up' }), expect.anything())
    expect(res).toEqual(expect.objectContaining({ pushFailed: true }))
  })

  test('a successful push flips pushed to true only after the push went out', async () => {
    sb.client.functions.invoke.mockResolvedValue({ data: { sent: 12 }, error: null })
    const { result } = renderHook(() => useNews())
    await waitFor(() => expect(result.current.loading).toBe(false))

    let res
    await act(async () => { res = await result.current.post({ title: 'Pitch change', body: 'On the 4G', push: true }) })

    const ins = sb.writes.find((w) => w.table === 'announcements' && w.op === 'insert')
    expect(ins.payload).toMatchObject({ pushed: false, title: 'Pitch change', body: 'On the 4G', club_id: 'c1', created_by: 'u1' })
    const upd = sb.writes.find((w) => w.table === 'announcements' && w.op === 'update')
    expect(upd.payload).toEqual({ pushed: true })
    expect(res).toEqual(expect.objectContaining({ pushFailed: false }))
  })

  test('a quiet post never invokes the push', async () => {
    const { result } = renderHook(() => useNews())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { await result.current.post({ title: 'Minor', body: 'Note', push: false }) })
    expect(sb.client.functions.invoke).not.toHaveBeenCalled()
    expect(sb.writes.filter((w) => w.op === 'update')).toEqual([])
  })
})
