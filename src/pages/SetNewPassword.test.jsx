import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SetNewPassword from './SetNewPassword'

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
    await userEvent.type(screen.getByLabelText('New password'), 'goodpass1')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'different1')
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))

    expect(screen.getByText(/don't match/i)).toBeInTheDocument()
    expect(h.updatePassword).not.toHaveBeenCalled()
  })

  test('blocks a too-short password', async () => {
    render(<SetNewPassword />)
    await userEvent.type(screen.getByLabelText('New password'), '123')
    await userEvent.type(screen.getByLabelText('Confirm password'), '123')
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))

    expect(screen.getByText(/at least 6/i)).toBeInTheDocument()
    expect(h.updatePassword).not.toHaveBeenCalled()
  })

  test('sets a valid password then ends recovery (signs in)', async () => {
    render(<SetNewPassword />)
    await userEvent.type(screen.getByLabelText('New password'), 'brandnew1')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'brandnew1')
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))

    await waitFor(() => expect(h.updatePassword).toHaveBeenCalledWith('brandnew1'))
    await waitFor(() => expect(h.endRecovery).toHaveBeenCalled())
  })
})
