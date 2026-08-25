import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Records every update as [table, payload, eqArgs] so the tests can assert the
// PII split: squad-visible fields → profiles, personal fields → profile_private.
const h = vi.hoisted(() => ({ calls: [] }))
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table) => ({
      update: (payload) => ({ eq: (...eqArgs) => { h.calls.push([table, payload, eqArgs]); return Promise.resolve({ error: null }) } }),
    }),
  },
}))

import ProfileEdit from './ProfileEdit'

const PROFILE = {
  id: 'me', first_name: 'Joe', last_name: 'Bloggs', email: 'joe@x.com',
  phone: '07700900000', dob: '1990-05-01', positions: ['CB'], preferred: 'CB', ec_name: null, ec_phone: null,
}

beforeEach(() => { h.calls.length = 0 })

describe('ProfileEdit (player self-edit)', () => {
  test('shows your details but NOT an email field — email is the account anchor', () => {
    render(<ProfileEdit open profile={PROFILE} onClose={() => {}} onSaved={() => {}} />)
    expect(screen.getByDisplayValue('Joe')).toBeInTheDocument()
    expect(screen.getByDisplayValue('07700900000')).toBeInTheDocument()
    // no editable email input
    expect(screen.queryByDisplayValue('joe@x.com')).toBeNull()
    expect(screen.getByText(/email is your login/i)).toBeInTheDocument()
  })

  test('saving splits the write: squad fields → profiles, PII → profile_private (never email/role/approval)', async () => {
    const onSaved = vi.fn(); const onClose = vi.fn()
    render(<ProfileEdit open profile={PROFILE} onClose={onClose} onSaved={onSaved} />)
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(h.calls.length).toBeGreaterThan(0))

    const prof = h.calls.find((c) => c[0] === 'profiles')
    expect(prof).toBeTruthy()
    expect(prof[1]).toMatchObject({ first_name: 'Joe', last_name: 'Bloggs', preferred: 'CB' })
    // PII and privileged/account columns must never hit the club-readable table
    for (const k of ['phone', 'dob', 'ec_name', 'ec_phone', 'email', 'role', 'active', 'approved', 'is_player', 'club_id']) {
      expect(k in prof[1]).toBe(false)
    }
    expect(prof[2]).toEqual(['id', 'me'])

    const priv = h.calls.find((c) => c[0] === 'profile_private')
    expect(priv).toBeTruthy()
    expect(priv[1]).toMatchObject({ phone: '07700900000', dob: '1990-05-01' })
    expect('email' in priv[1]).toBe(false) // email is the login — the manager changes it
    expect(priv[2]).toEqual(['profile_id', 'me'])
    expect(onSaved).toHaveBeenCalled()
  })

  test('a required field cleared blocks the save (no write)', async () => {
    render(<ProfileEdit open profile={PROFILE} onClose={() => {}} onSaved={() => {}} />)
    await userEvent.clear(screen.getByDisplayValue('Joe')) // first name
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(h.calls.length).toBe(0)
  })
})
