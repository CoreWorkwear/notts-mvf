import { beforeEach, expect, test, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
const state = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: state.rpc } }))
import { usePaymentsRelease } from './usePaymentsRelease'
beforeEach(() => state.rpc.mockReset())

test('retains cutover when release is paused', async () => {
  state.rpc.mockResolvedValue({ data: { enabled: false, cutover_at: '2026-11-24T00:00:00Z' }, error: null })
  const { result } = renderHook(usePaymentsRelease)
  expect(result.current.loading).toBe(true)
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current).toMatchObject({ enabled: false, cutover_at: '2026-11-24T00:00:00Z', error: false })
})

test('failed status can retry and never assumes payments enabled', async () => {
  state.rpc.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ data: { enabled: true, cutover_at: null } })
  const { result } = renderHook(usePaymentsRelease)
  await waitFor(() => expect(result.current.error).toBe(true))
  expect(result.current.enabled).toBe(false)
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.enabled).toBe(true))
})

test('focus and visibility refresh release state; changing club discards the previous permission immediately', async () => {
  state.rpc.mockResolvedValue({ data: { enabled: true, cutover_at: null } })
  const { result, rerender } = renderHook(({ club }) => usePaymentsRelease('manager', club), { initialProps: { club: 'club-a' } })
  await waitFor(() => expect(result.current.enabled).toBe(true))
  state.rpc.mockResolvedValue({ data: { enabled: false, cutover_at: '2026-11-24' } })
  act(() => window.dispatchEvent(new Event('focus')))
  await waitFor(() => expect(result.current.enabled).toBe(false))
  state.rpc.mockResolvedValue({ data: { enabled: true, cutover_at: null } })
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  await waitFor(() => expect(result.current.enabled).toBe(true))
  let finish
  state.rpc.mockReturnValue(new Promise(resolve => { finish = resolve }))
  rerender({ club: 'club-b' })
  expect(result.current.enabled).toBe(false)
  expect(result.current.loading).toBe(true)
  expect(result.current.cutover_at).toBeNull()
  await act(async () => { finish({ data: { enabled: false, cutover_at: null } }) })
})
