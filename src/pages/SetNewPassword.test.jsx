import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SetNewPassword from './SetNewPassword'
import { MIN_PASSWORD } from '../lib/constants'

const h = vi.hoisted(() => ({ updatePassword: vi.fn(), endRecovery: vi.fn() }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ updatePassword: h.updatePassword, endRecovery: h.endRecovery }),
}))
vi.mock('../components/Crest', () => ({ default: () => null }))

beforeEach(() => {
  h.updatePassword.mockReset().mockResolvedValue({ error: null })
  h.endRecovery.mockReset()
})

describe('SetNewPassword', () => {
  test('blocks mismatched passwords and does not call updatePassword', async () => {
    render(<SetNewPassword />)
    await userEvent.type(screen.getByLabelText('New password'), 'a-good-long-one')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'a-different-one')
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))

    expect(screen.getByText(/don't match/i)).toBeInTheDocument()
    expect(h.updatePassword).not.toHaveBeenCalled()
  })

  // Reads the floor from the constant rather than hard-coding it, so moving
  // MIN_PASSWORD again changes one line and this test still means something.
  test('blocks a too-short password', async () => {
    render(<SetNewPassword />)
    const tooShort = 'x'.repeat(MIN_PASSWORD - 1)
    await userEvent.type(screen.getByLabelText('New password'), tooShort)
    await userEvent.type(screen.getByLabelText('Confirm password'), tooShort)
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))

    expect(screen.getByText(new RegExp(`at least ${MIN_PASSWORD}`, 'i'))).toBeInTheDocument()
    expect(h.updatePassword).not.toHaveBeenCalled()
  })

  test('sets a valid password then ends recovery (signs in)', async () => {
    render(<SetNewPassword />)
    await userEvent.type(screen.getByLabelText('New password'), 'brand-new-one')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'brand-new-one')
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))

    await waitFor(() => expect(h.updatePassword).toHaveBeenCalledWith('brand-new-one'))
    // confirmation toast shows first…
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/password changed/i))
    // …then recovery ends and the app takes over
    await waitFor(() => expect(h.endRecovery).toHaveBeenCalled(), { timeout: 2500 })
  })
})
