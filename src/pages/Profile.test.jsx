import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// The You page's personal fields come from profile_private. ProfileEdit
// initialises its inputs from that row, so opening it before the row has
// loaded shows blank phone/DOB/emergency contact — and a save then WIPES
// them. The edit sheet must be gated on the fetch having succeeded.

const store = vi.hoisted(() => ({
  priv: { email: 'joe@x.com', phone: '07700900000', dob: null, ec_name: null, ec_phone: null },
  privErr: null,
}))
vi.mock('../lib/supabase', () => {
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: () => Promise.resolve(store.privErr ? { data: null, error: store.privErr } : { data: store.priv, error: null }),
  }
  return { supabase: { from: () => q } }
})
vi.mock('../lib/logger', () => ({ logError: vi.fn() }))
const who = vi.hoisted(() => ({ account: { approved: true, active: true } }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    profile: { id: 'me', first_name: 'Joe', last_name: 'Bloggs', positions: [], preferred: null, photo_url: null, ...who.account },
    teamKeys: [],
    isRealAdmin: false,
    refreshProfile: vi.fn(),
  }),
}))
vi.mock('../components/NotificationToggle', () => ({ default: () => null }))
vi.mock('../components/ImageUpload', () => ({ default: ({ label }) => <button>{label}</button> }))
vi.mock('../components/ProfileEdit', () => ({ default: ({ open }) => (open ? <div data-testid="edit-sheet" /> : null) }))

import Profile from './Profile'

beforeEach(() => { store.privErr = null; who.account = { approved: true, active: true } })

describe('Profile — the edit sheet is gated on the private row (data-loss guard)', () => {
  test('when the private-row fetch failed, Edit pops a toast and does NOT open the sheet', async () => {
    store.privErr = { message: 'boom' }
    render(<Profile />)
    await userEvent.click(screen.getByRole('button', { name: /edit your details/i }))

    // Old code opened the sheet with blank fields — a save wiped phone/DOB/EC.
    expect(screen.queryByTestId('edit-sheet')).toBeNull()
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't load your details/i)
  })

  test('once the private row has loaded, Edit opens', async () => {
    render(<Profile />)
    await waitFor(() => expect(screen.getByText('joe@x.com')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /edit your details/i }))
    expect(screen.getByTestId('edit-sheet')).toBeInTheDocument()
  })
})

// Storage only takes a headshot from an approved, active member (0030/0031).
// The button was offered to everyone, and a pending sign-up who used it got the
// raw "new row violates row-level security policy" back.
describe('Profile — the photo upload is for signed-off members', () => {
  test('a signed-off member is offered it', () => {
    render(<Profile />)
    expect(screen.getByRole('button', { name: /add your photo/i })).toBeInTheDocument()
  })

  test('awaiting sign-off: no button, and a line saying when it opens', () => {
    who.account = { approved: false, active: true }
    render(<Profile />)
    expect(screen.queryByRole('button', { name: /add your photo/i })).toBeNull()
    expect(screen.getByText(/photo upload requires manager approval/i)).toBeInTheDocument()
  })

  test('an inactive account is not offered it either', () => {
    who.account = { approved: true, active: false }
    render(<Profile />)
    expect(screen.queryByRole('button', { name: /add your photo/i })).toBeNull()
  })
})
