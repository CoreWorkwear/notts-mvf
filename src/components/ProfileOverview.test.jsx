import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
const state = vi.hoisted(() => ({ profile: {}, upload: null, update: vi.fn(), refresh: vi.fn() }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ profile: state.profile, teamKeys: ['xl'], isRealAdmin: false, refreshProfile: state.refresh }) }))
vi.mock('../lib/supabase', () => ({ supabase: { from: () => ({ update: payload => { state.update(payload); return { eq: async () => ({ error: null }) } } }) } }))
vi.mock('./ImageUpload', () => ({ default: props => { state.upload = props; return <button>{props.label}</button> } }))
vi.mock('./PlayerAccount', () => ({ default: () => <section aria-label="Player account">Balance and statement</section> }))
vi.mock('./NotificationToggle', () => ({ default: () => <button>Notifications on</button> }))
vi.mock('./FeelSettings', () => ({ default: () => <button>Touch feedback</button> }))
vi.mock('./InstallPrompt', () => ({ default: () => null }))
import ProfileOverview from './ProfileOverview'
beforeEach(() => { state.profile = { id: 'me', first_name: 'Joe', last_name: 'Bloggs', photo_url: null, is_player: true, approved: true, active: true }; state.update.mockClear() })
const view = () => render(<MemoryRouter><ProfileOverview /></MemoryRouter>)

test('one identity, compact photo control, account order and collapsed settings', () => {
  view()
  expect(screen.getByLabelText('Initials JB')).toBeInTheDocument()
  expect(state.upload.compact).toBe(true)
  expect(state.upload.folder).toBe('players/me')
  expect(screen.getByRole('button', { name: 'Add photo' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Edit details' })).toHaveAttribute('href', '/you/details')
  expect(screen.getByText('App settings').closest('details')).not.toHaveAttribute('open')
  expect(screen.getByRole('button', { name: 'Notifications on' })).toBeInTheDocument()
  expect(screen.queryByText('Phone')).not.toBeInTheDocument()
})

test('header name save only updates first name and surname and refreshes the heading', async () => {
  view()
  await userEvent.click(screen.getByRole('button', { name: 'Edit name' }))
  await userEvent.clear(screen.getByLabelText('First name'))
  await userEvent.type(screen.getByLabelText('First name'), 'Sam')
  await userEvent.click(screen.getByRole('button', { name: 'Save name' }))
  expect(await screen.findByRole('heading', { name: 'Sam Bloggs' })).toBeInTheDocument()
  expect(state.update).toHaveBeenCalledWith({ first_name: 'Sam', last_name: 'Bloggs' })
  expect(state.refresh).toHaveBeenCalled()
})

test('pending member keeps their identity without an upload control', () => {
  state.profile.approved = false
  view()
  expect(screen.queryByRole('button', { name: 'Add photo' })).not.toBeInTheDocument()
  expect(screen.getByText('Photo upload requires manager approval.')).toBeInTheDocument()
})
