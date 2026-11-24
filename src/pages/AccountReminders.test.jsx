import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
const state = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), isAdmin: true, enabled: true, club: 'club' }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: state.rpc, functions: { invoke: state.invoke } } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'manager' }, profile: { club_id: state.club }, isAdmin: state.isAdmin }) }))
vi.mock('../hooks/usePaymentsRelease', () => ({ usePaymentsRelease: () => ({ enabled: state.enabled }) }))
import AccountReminders from './AccountReminders'
const targets = [{ profile_id: 'joe', first_name: 'Joe', balance_pence: -900 }, { profile_id: 'sam', first_name: 'Sam', balance_pence: -400 }]
beforeEach(() => { state.rpc.mockReset().mockResolvedValue({ data: targets }); state.invoke.mockReset().mockResolvedValue({ data: { targeted: 2, push_sent: 1, push_status: 'partial' } }); state.isAdmin = true; state.enabled = true; state.club = crypto.randomUUID(); sessionStorage.clear() })
const view = () => render(<MemoryRouter><AccountReminders /></MemoryRouter>)

test('manager reviews arrears and sends once with a stable client request', async () => {
  view()
  expect(await screen.findByRole('region', { name: 'Players in arrears' })).toHaveTextContent('Joe£9.00 owed')
  await userEvent.click(screen.getByRole('button', { name: 'Send account reminders' }))
  expect(await screen.findByText('In-app reminders created for 2 players.')).toBeInTheDocument()
  expect(screen.getByText(/Push notifications sent: 1/)).toHaveTextContent('not confirmed')
  expect(screen.getByRole('button', { name: 'Send account reminders' })).toBeDisabled()
  expect(state.invoke.mock.calls[0][0]).toBe('send-account-reminders')
  expect(state.invoke.mock.calls[0][1].body.request_id).toMatch(/^[\da-f-]{36}$/i)
})

test('uncertain send survives reopening and retries even after the target list becomes empty', async () => {
  state.invoke.mockRejectedValueOnce(new Error('response lost')).mockResolvedValue({ data: { targeted: 2, push_sent: 0, push_status: 'unavailable' } })
  const first = view()
  await userEvent.click(await screen.findByRole('button', { name: 'Send account reminders' }))
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't confirm")
  first.unmount(); state.rpc.mockResolvedValue({ data: [] }); view()
  await screen.findByText('No players are in arrears.')
  await userEvent.click(screen.getByRole('button', { name: 'Retry account reminders' }))
  await screen.findByText('In-app reminders created for 2 players.')
  expect(state.invoke.mock.calls[1][1].body).toEqual(state.invoke.mock.calls[0][1].body)
})

test('empty target list disables send and sharing without invoking the sender', async () => {
  state.rpc.mockResolvedValue({ data: [] }); view()
  await screen.findByText('No players are in arrears.')
  expect(screen.getByRole('button', { name: 'Send account reminders' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'WhatsApp Share' })).toBeDisabled()
  expect(state.invoke).not.toHaveBeenCalled()
})

test('WhatsApp prepares first names and a neutral own-account link before sharing locally', async () => {
  const share = vi.fn().mockResolvedValue()
  Object.defineProperty(navigator, 'share', { configurable: true, value: share })
  view(); await screen.findByText('Joe')
  await userEvent.click(screen.getByRole('button', { name: 'WhatsApp Share' }))
  const text = screen.getByLabelText('WhatsApp message')
  expect(text).toHaveValue(`Joe, Sam — please check your current subs account: ${new URL('/you', window.location.origin).href}`)
  expect(text.value).not.toMatch(/£|joe|sam|profile_id/)
  expect(share).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Share message' }))
  expect(share).toHaveBeenCalledWith({ text: text.value })
  expect(state.invoke).not.toHaveBeenCalled()
  delete navigator.share
})

test('failed review offers retry instead of posing as an empty target list', async () => {
  state.rpc.mockRejectedValueOnce(new Error('offline')); view()
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load players in arrears")
  expect(screen.queryByText('No players are in arrears.')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Send account reminders' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Joe')).toBeInTheDocument()
})

test.each(['player', 'disabled'])('%s cannot load targets or send reminders', async mode => {
  if (mode === 'player') state.isAdmin = false
  else state.enabled = false
  view()
  await waitFor(() => expect(state.rpc).not.toHaveBeenCalled())
  expect(screen.queryByRole('button', { name: 'Send account reminders' })).not.toBeInTheDocument()
})
