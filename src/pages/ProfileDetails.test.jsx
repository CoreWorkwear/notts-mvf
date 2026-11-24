import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
const state = vi.hoisted(() => ({ fail: false, updates: [], refresh: vi.fn() }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'me', club_id: 'club', first_name: 'Joe', last_name: 'Bloggs', positions: ['GK'], preferred: 'GK' }, refreshProfile: state.refresh }) }))
vi.mock('../hooks/usePaymentsRelease', () => ({ usePaymentsRelease: () => ({ enabled: true }) }))
vi.mock('../lib/supabase', () => ({ supabase: { from: table => {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => state.fail ? { error: { message: 'offline' } } : { data: { email: 'joe@example.com', phone: '07700900123', dob: '1990-01-02', ec_name: 'Jane', ec_phone: '07700900456' } }, update: payload => { state.updates.push({ table, payload }); return { eq: async () => ({ error: null }) } } }
  return query
} } }))
import ProfileDetails from './ProfileDetails'
beforeEach(() => { state.fail = false; state.updates = []; state.refresh.mockClear() })
const view = () => render(<MemoryRouter initialEntries={['/you/details']}><Routes><Route path="/you/details" element={<ProfileDetails />} /><Route path="/you" element={<h1>You overview</h1>} /></Routes></MemoryRouter>)

test('private details require a successful load; retry restores existing details before enabling save', async () => {
  state.fail = true
  view()
  expect(await screen.findByRole('alert')).toHaveTextContent('Existing details have been kept')
  expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  state.fail = false
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByLabelText('Phone')).toHaveValue('07700900123')
  expect(screen.getByLabelText('Sign-in email')).toHaveAttribute('readonly')
  expect(screen.queryByLabelText('First name')).not.toBeInTheDocument()
})

test('private details save preserves header name, writes existing fields and returns to You', async () => {
  view()
  const phone = await screen.findByLabelText('Phone')
  await userEvent.clear(phone)
  await userEvent.type(phone, '07700900999')
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByRole('heading', { name: 'You overview' })).toBeInTheDocument()
  expect(state.updates).toEqual([{ table: 'profiles', payload: { positions: ['GK'], preferred: 'GK' } }, { table: 'profile_private', payload: { phone: '07700900999', dob: '1990-01-02', ec_name: 'Jane', ec_phone: '07700900456' } }])
})

test('Back discards edits without writing', async () => {
  view()
  await userEvent.clear(await screen.findByLabelText('Phone'))
  await userEvent.click(screen.getByRole('link', { name: 'Back' }))
  await waitFor(() => expect(screen.getByRole('heading', { name: 'You overview' })).toBeInTheDocument())
  expect(state.updates).toEqual([])
})
