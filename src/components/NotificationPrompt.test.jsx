import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const enablePush = vi.hoisted(() => vi.fn())
let supported
vi.mock('../lib/push', () => ({ get pushSupported() { return supported }, enablePush }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))

import NotificationPrompt from './NotificationPrompt'

const setPermission = (p) => Object.defineProperty(window, 'Notification', { value: { permission: p }, configurable: true })

beforeEach(() => { enablePush.mockReset(); enablePush.mockResolvedValue(); supported = true; setPermission('default') })

describe('NotificationPrompt (§3.6)', () => {
  test('shows while permission is default', () => {
    render(<NotificationPrompt />)
    expect(screen.getByRole('region', { name: /turn on notifications/i })).toBeVisible()
  })

  test('hidden once granted or denied (never nags the settled)', () => {
    setPermission('granted')
    const { rerender } = render(<NotificationPrompt />)
    expect(screen.queryByRole('region', { name: /turn on notifications/i })).not.toBeInTheDocument()
    setPermission('denied'); rerender(<NotificationPrompt />)
    expect(screen.queryByRole('region', { name: /turn on notifications/i })).not.toBeInTheDocument()
  })

  test('"Turn on" enables push', async () => {
    render(<NotificationPrompt />)
    await userEvent.click(screen.getByRole('button', { name: /turn on/i }))
    await waitFor(() => expect(enablePush).toHaveBeenCalledWith('u1'))
  })

  test('"Not now" dismisses it for the session', async () => {
    render(<NotificationPrompt />)
    await userEvent.click(screen.getByRole('button', { name: /not now/i }))
    expect(screen.queryByRole('region', { name: /turn on notifications/i })).not.toBeInTheDocument()
    expect(enablePush).not.toHaveBeenCalled()
  })

  test('hidden when push is unsupported', () => {
    supported = false
    render(<NotificationPrompt />)
    expect(screen.queryByRole('region', { name: /turn on notifications/i })).not.toBeInTheDocument()
  })
})
