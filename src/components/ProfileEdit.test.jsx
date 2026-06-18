import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const eq = vi.fn().mockResolvedValue({ error: null })
const update = vi.fn(() => ({ eq }))
vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => ({ update })) } }))

import ProfileEdit from './ProfileEdit'

const PROFILE = {
  id: 'me', first_name: 'Joe', last_name: 'Bloggs', email: 'joe@x.com',
  phone: '07700900000', dob: '1990-05-01', positions: ['CB'], preferred: 'CB', ec_name: null, ec_phone: null,
}

beforeEach(() => { update.mockClear(); eq.mockClear() })

describe('ProfileEdit (player self-edit)', () => {
  test('shows your details but NOT an email field — email is the account anchor', () => {
    render(<ProfileEdit open profile={PROFILE} onClose={() => {}} onSaved={() => {}} />)
    expect(screen.getByDisplayValue('Joe')).toBeInTheDocument()
    expect(screen.getByDisplayValue('07700900000')).toBeInTheDocument()
    // no editable email input
    expect(screen.queryByDisplayValue('joe@x.com')).toBeNull()
    expect(screen.getByText(/email is your login/i)).toBeInTheDocument()
  })

  test('saving writes only the player\'s own personal fields (no email / role / approval)', async () => {
    const onSaved = vi.fn(); const onClose = vi.fn()
    render(<ProfileEdit open profile={PROFILE} onClose={onClose} onSaved={onSaved} />)
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(update).toHaveBeenCalled())
    const payload = update.mock.calls[0][0]
    expect(payload).toMatchObject({ first_name: 'Joe', last_name: 'Bloggs', phone: '07700900000', preferred: 'CB' })
    // privileged / account columns must never be in a self-edit payload
    for (const k of ['email', 'role', 'active', 'approved', 'is_player', 'club_id']) {
      expect(k in payload).toBe(false)
    }
    expect(eq).toHaveBeenCalledWith('id', 'me')
    expect(onSaved).toHaveBeenCalled()
  })

  test('a required field cleared blocks the save (no write)', async () => {
    render(<ProfileEdit open profile={PROFILE} onClose={() => {}} onSaved={() => {}} />)
    await userEvent.clear(screen.getByDisplayValue('Joe')) // first name
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
  })
})
