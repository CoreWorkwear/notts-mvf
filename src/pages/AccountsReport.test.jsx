import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
const state = vi.hoisted(() => ({ rpc: vi.fn(), isAdmin: true, release: { enabled: true, loading: false, error: false, retry: vi.fn() } }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: state.rpc } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'manager' }, profile: { club_id: 'club' }, isAdmin: state.isAdmin }) }))
vi.mock('../hooks/usePaymentsRelease', () => ({ usePaymentsRelease: () => state.release }))
import AccountsReport from './AccountsReport'

const fixture = () => ({ from: '2026-11-01', to: '2026-11-24', categories: [
  { category: 'first_team', charges_pence: 700, corrections_pence: 0, net_charges_pence: 700, entries: [{ id: 'match', occurred_on: '2026-11-01', player_name: 'Joe Bloggs', description: 'Nottingham v Boston', amount_pence: 700, activity_type: 'fixture', activity_id: 'fixture-id' }] },
  { category: 'community', charges_pence: 0, corrections_pence: 0, net_charges_pence: 0, entries: [] },
  { category: 'training', charges_pence: 400, corrections_pence: 0, net_charges_pence: 400, entries: [] },
  { category: 'fines', charges_pence: 500, corrections_pence: -500, net_charges_pence: 0, entries: [{ id: 'fine-reversal', occurred_on: '2026-11-20', player_name: 'Joe Bloggs', description: 'Fine correction', amount_pence: -500, linked_entry_id: 'fine-original', original_charge_id: 'fine-original', original_occurred_on: '2026-10-31' }] },
], totals: { charges_pence: 1600, corrections_pence: -500, net_charges_pence: 1100 }, receipts: { gross_pence: 3000, refunds_pence: -200, reversals_pence: 0, net_pence: 2800, methods: [{ method: 'bank', gross_pence: 3000, refunds_pence: -200, reversals_pence: 0, net_pence: 2800 }], entries: [{ id: 'receipt', kind: 'receipt', method: 'bank', occurred_on: '2026-11-10', player_name: 'Joe Bloggs', description: 'Bank transfer', reference: 'SUBS', amount_pence: 3000 }, { id: 'refund', kind: 'refund', method: 'bank', occurred_on: '2026-11-12', player_name: 'Joe Bloggs', description: 'Money refund', amount_pence: -200, linked_entry_id: 'receipt' }] } })
beforeEach(() => { state.rpc.mockReset().mockResolvedValue({ data: fixture(), error: null }); state.isAdmin = true; state.release.enabled = true; state.release.error = false })

test('all four charge categories, signed correction and grand total are distinct from receipts', async () => {
  render(<AccountsReport />)
  const table = await screen.findByRole('table', { name: 'Activity charge totals' })
  expect(within(table).getByRole('row', { name: 'First Team £7.00 £0.00 £7.00' })).toBeInTheDocument()
  expect(within(table).getByRole('row', { name: 'Community £0.00 £0.00 £0.00' })).toBeInTheDocument()
  expect(within(table).getByRole('row', { name: 'Fines £5.00 -£5.00 £0.00' })).toBeInTheDocument()
  expect(within(table).getByRole('row', { name: 'Grand total £16.00 -£5.00 £11.00' })).toBeInTheDocument()
  const receipts = screen.getByRole('region', { name: 'Club receipts' })
  expect(receipts).toHaveTextContent('Gross receipts£30.00')
  expect(receipts).toHaveTextContent('Refunds-£2.00')
  expect(receipts).toHaveTextContent('Linked receipt: receipt')
  expect(table).not.toHaveTextContent('£30.00')
})

test('inclusive date filter submits exact selected dates and rejects inverted periods', async () => {
  render(<AccountsReport />)
  await screen.findByRole('table')
  await userEvent.clear(screen.getByLabelText('From'))
  await userEvent.type(screen.getByLabelText('From'), '2026-12-02')
  await userEvent.clear(screen.getByLabelText('To'))
  await userEvent.type(screen.getByLabelText('To'), '2026-12-01')
  await userEvent.click(screen.getByRole('button', { name: 'Show report' }))
  expect(screen.getByRole('alert')).toHaveTextContent('on or before')
  expect(state.rpc).toHaveBeenCalledTimes(1)
  await userEvent.clear(screen.getByLabelText('To'))
  await userEvent.type(screen.getByLabelText('To'), '2026-12-02')
  await userEvent.click(screen.getByRole('button', { name: 'Show report' }))
  await waitFor(() => expect(state.rpc).toHaveBeenLastCalledWith('get_activity_finance_report', { p_from: '2026-12-02', p_to: '2026-12-02' }))
})

test('cross-period correction opens its original charge date, expands detail and focuses the original', async () => {
  state.rpc.mockResolvedValueOnce({ data: fixture() }).mockResolvedValue({ data: { ...fixture(), from: '2026-10-31', to: '2026-10-31', categories: [{ category: 'fines', charges_pence: 500, corrections_pence: 0, net_charges_pence: 500, entries: [{ id: 'fine-original', occurred_on: '2026-10-31', player_name: 'Joe Bloggs', description: 'Late arrival', amount_pence: 500 }] }] } })
  render(<AccountsReport />)
  await screen.findByRole('table')
  await userEvent.click(screen.getByText('Fines details', { selector: 'summary' }))
  await userEvent.click(screen.getByRole('button', { name: 'View original charge' }))
  const original = await screen.findByText('Late arrival')
  expect(state.rpc).toHaveBeenLastCalledWith('get_activity_finance_report', { p_from: '2026-10-31', p_to: '2026-10-31' })
  expect(original.closest('details')).toHaveAttribute('open')
  expect(original.closest('li')).toHaveFocus()
})

test('failed report is unavailable and retryable, never zero', async () => {
  state.rpc.mockRejectedValueOnce(new Error('offline'))
  render(<AccountsReport />)
  expect(await screen.findByRole('alert')).toHaveTextContent('totals are unavailable')
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByRole('table')).toBeInTheDocument()
})

test.each(['player', 'disabled'])('%s cannot request or see report data', async mode => {
  if (mode === 'player') state.isAdmin = false
  else state.release.enabled = false
  render(<AccountsReport />)
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Show report' })).not.toBeInTheDocument()
  expect(state.rpc).not.toHaveBeenCalled()
})
