import { render, screen, fireEvent } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import UpdatePrompt from './UpdatePrompt'
import { registerForUpdates } from '../lib/pwaUpdate'

test('leaves the app usable when browser policy suppresses registration', async () => {
  vi.stubGlobal('navigator', { serviceWorker: { register: vi.fn(async () => undefined) } })
  try {
    await expect(registerForUpdates()).resolves.toBeUndefined()
    render(<UpdatePrompt />)
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull()
  } finally { vi.unstubAllGlobals() }
})

test('renders a worker already waiting before React mounts and accepts it only once', async () => {
  vi.useFakeTimers()
  const waiting = Object.assign(new EventTarget(), { state: 'installed', postMessage: vi.fn() })
  const registration = Object.assign(new EventTarget(), { waiting, active: {}, update: vi.fn(() => Promise.resolve()) })
  const serviceWorker = Object.assign(new EventTarget(), { register: vi.fn(async () => registration) })
  vi.stubGlobal('navigator', { serviceWorker })
  try {
    await registerForUpdates()
    render(<UpdatePrompt />)
    const refresh = screen.getByRole('button', { name: 'Refresh' })
    expect(refresh).toBeEnabled()
    fireEvent.click(refresh)
    fireEvent.click(refresh)
    expect(waiting.postMessage).toHaveBeenCalledTimes(1)
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(refresh).toBeDisabled()
  } finally {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  }
})
