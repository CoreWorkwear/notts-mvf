import { beforeEach, expect, test, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
const state = vi.hoisted(() => ({ rpc: vi.fn(), auth: {}, enabled: true }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: state.rpc } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => state.auth }))
vi.mock('../hooks/usePaymentsRelease', () => ({ usePaymentsRelease: () => ({ enabled: state.enabled }) }))
import AccountReminderBanner from './AccountReminderBanner'
const notice = { id: 'reminder-1', created_at: '2026-11-24T10:00:00Z' }
beforeEach(() => { state.rpc.mockReset().mockResolvedValue({ data: notice }); state.enabled = true; state.auth = { user: { id: 'joe' }, profile: { id: 'joe', club_id: 'club', active: true, approved: true, is_player: true } }; localStorage.clear() })
const view = () => render(<MemoryRouter><AccountReminderBanner /></MemoryRouter>)

test('neutral reminder links to the signed-in current account with no historic amount', async () => {
  view()
  const banner = await screen.findByRole('complementary', { name: 'Account reminder' })
  expect(banner).toHaveTextContent('Check your current subs account.')
  expect(screen.getByRole('link', { name: 'View your account' })).toHaveAttribute('href', '/you')
  expect(banner.textContent).not.toContain('£')
})

test('dismissal is local to this player and reminder; a newer reminder returns on focus', async () => {
  view(); await screen.findByRole('complementary')
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss account reminder' }))
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  state.rpc.mockResolvedValue({ data: { ...notice, id: 'reminder-2' } })
  fireEvent.focus(window)
  expect(await screen.findByRole('complementary')).toBeInTheDocument()
  expect(state.rpc).toHaveBeenCalledTimes(2)
})

test('identity changes immediately hide previous notices and ignore late responses', async () => {
  let finish
  state.rpc.mockReturnValueOnce(new Promise(resolve => { finish = resolve })).mockResolvedValue({ data: null })
  const current = view()
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1))
  state.auth = { user: { id: 'sam' }, profile: { id: 'sam', club_id: 'other-club', active: true, approved: true, is_player: true } }
  current.rerender(<MemoryRouter><AccountReminderBanner /></MemoryRouter>)
  await act(async () => finish({ data: notice }))
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
})

test.each(['disabled', 'supporter', 'unapproved', 'inactive', 'not_owner'])('%s has no account reminder or read', async reason => {
  if (reason === 'disabled') state.enabled = false
  if (reason === 'supporter') state.auth.profile.is_player = false
  if (reason === 'unapproved') state.auth.profile.approved = false
  if (reason === 'inactive') state.auth.profile.active = false
  if (reason === 'not_owner') state.auth.user.id = 'manager'
  view()
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  expect(state.rpc).not.toHaveBeenCalled()
})
