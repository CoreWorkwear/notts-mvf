import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
const state = vi.hoisted(() => ({ rpc: vi.fn(), isAdmin: true, enabled: true, playersError: null }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'manager' }, profile: { club_id: 'club' }, isAdmin: state.isAdmin }) }))
vi.mock('../hooks/usePaymentsRelease', () => ({ usePaymentsRelease: () => ({ enabled: state.enabled, loading: false, error: false }) }))
vi.mock('../hooks/usePlayers', () => ({ usePlayers: () => ({ loading: false, error: state.playersError, refetch: vi.fn(), players: [
  { id: 'joe', first_name: 'Joe', last_name: 'Bloggs', active: true, approved: true, is_player: true },
  { id: 'pending', first_name: 'Pending', last_name: 'Player', active: true, approved: false, is_player: true },
  { id: 'supporter', first_name: 'Club', last_name: 'Supporter', active: true, approved: true, is_player: false },
] }) }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: state.rpc } }))
import OpeningBalances from './OpeningBalances'
const empty = { effective_on: null, account_count: 0, credit_count: 0, arrears_count: 0, settled_count: 0, opening_credit_pence: 0, opening_arrears_pence: 0, net_opening_pence: 0, entries: [] }
const view = () => render(<MemoryRouter><OpeningBalances /></MemoryRouter>)
beforeEach(() => { sessionStorage.clear(); state.rpc.mockReset().mockResolvedValue({ data: empty }); state.isAdmin = true; state.enabled = true; state.playersError = null })

test('summary keeps opening credit and arrears separate, shows locked date and records', async () => {
  state.rpc.mockResolvedValue({ data: { ...empty, effective_on: '2026-12-01', account_count: 2, credit_count: 1, arrears_count: 1, opening_credit_pence: 1800, opening_arrears_pence: 700, net_opening_pence: 1100, entries: [{ id: 'a', profile_id: 'old-player', player_name: 'Sam Lee', amount_pence: -700, effective_on: '2026-12-01' }] } })
  view()
  const summary = await screen.findByRole('region', { name: 'Opening totals' })
  expect(summary).toHaveTextContent('Opening credit£18.00')
  expect(summary).toHaveTextContent('Opening arrears£7.00')
  expect(screen.queryByLabelText('Effective date')).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Opening records' })).toHaveTextContent('Sam Lee£7.00 in arrears')
  expect(screen.queryByRole('option', { name: 'Pending Player' })).not.toBeInTheDocument()
  expect(screen.queryByRole('option', { name: 'Club Supporter' })).not.toBeInTheDocument()
})

test.each([['credit', '18.00', 1800], ['arrears', '7', -700], ['settled', '', 0]])('posts %s opening with signed whole pence', async (direction, amount, signed) => {
  let saved = false
  state.rpc.mockImplementation(async name => name === 'record_account_opening' ? (saved = true, { data: 'opening-id' }) : { data: saved ? { ...empty, effective_on: '2026-12-01' } : empty })
  view()
  await userEvent.selectOptions(await screen.findByLabelText('Player'), 'joe')
  await userEvent.selectOptions(screen.getByLabelText('Opening balance'), direction)
  if (amount) await userEvent.type(screen.getByLabelText('Amount (£)'), amount)
  await userEvent.clear(screen.getByLabelText('Effective date'))
  await userEvent.type(screen.getByLabelText('Effective date'), '2026-12-01')
  await userEvent.click(screen.getByRole('button', { name: 'Save opening balance' }))
  expect(await screen.findByText(/Opening balance saved for Joe Bloggs/)).toBeInTheDocument()
  const request = state.rpc.mock.calls.find(([name]) => name === 'record_account_opening')[1]
  expect(request).toMatchObject({ p_profile_id: 'joe', p_amount_pence: signed, p_effective_on: '2026-12-01' })
  expect(request.p_request_id).toMatch(/^[\da-f-]{36}$/i)
})

test('ambiguous opening survives navigation and a paused refusal with the same immutable request', async () => {
  const replies = [{ error: { message: 'response lost' } }, { error: { code: '42501' } }, { data: 'opening-id' }]
  state.rpc.mockImplementation(async name => name === 'record_account_opening' ? replies.shift() : { data: empty })
  const first = view()
  await userEvent.selectOptions(await screen.findByLabelText('Player'), 'joe')
  await userEvent.type(screen.getByLabelText('Amount (£)'), '18')
  await userEvent.click(screen.getByRole('button', { name: 'Save opening balance' }))
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't confirm")
  expect(screen.queryByText(/Opening balance saved/)).not.toBeInTheDocument()
  first.unmount()
  view()
  await userEvent.click(await screen.findByRole('button', { name: 'Retry opening balance' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('may be paused')
  expect(screen.getByLabelText('Amount (£)')).toBeDisabled()
  expect(screen.getByLabelText('Player')).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Retry opening balance' }))
  expect(await screen.findByText(/Opening balance saved for Joe Bloggs/)).toBeInTheDocument()
  const requests = state.rpc.mock.calls.filter(([name]) => name === 'record_account_opening').map(([, payload]) => payload)
  expect(requests).toHaveLength(3)
  expect(requests[1]).toEqual(requests[0]); expect(requests[2]).toEqual(requests[0])
})

test('load failure offers retry without displaying zero totals or a save button', async () => {
  state.rpc.mockRejectedValueOnce(new Error('offline'))
  view()
  expect(await screen.findByRole('alert')).toHaveTextContent('Opening totals are unavailable')
  expect(screen.queryByRole('region', { name: 'Opening totals' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save opening balance' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByRole('region', { name: 'Opening totals' })).toBeInTheDocument()
})

test('player load failure protects the form while preserving opening totals', async () => {
  state.playersError = new Error('offline')
  view()
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the players")
  expect(screen.queryByRole('button', { name: 'Save opening balance' })).not.toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: 'Opening totals' })).getByText('Opening credit')).toBeInTheDocument()
})

test.each(['player', 'disabled'])('%s cannot request opening records', async mode => {
  if (mode === 'player') state.isAdmin = false
  else state.enabled = false
  view()
  await waitFor(() => expect(state.rpc).not.toHaveBeenCalled())
  expect(screen.queryByLabelText('Player')).not.toBeInTheDocument()
})
