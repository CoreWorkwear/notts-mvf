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
  expect(within(receipts).getByRole('button', { name: 'Export bank and cash CSV' })).toBeVisible()
  expect(table).not.toHaveTextContent('£30.00')
})

test('receipt correction opens its original entry on the player statement', async () => {
  const report = fixture()
  report.receipts.entries[1].profile_id = 'player'
  state.rpc.mockResolvedValueOnce({ data: report }).mockResolvedValue({
    data: {
      profile_id: 'player', balance_pence: 2800,
      entries: [{ id: 'receipt', kind: 'receipt', description: 'Bank transfer', source: 'bank',
        occurred_on: '2026-10-31', reference: 'Earlier transfer', amount_pence: 3000, running_balance_pence: 3000 }],
    },
  })
  render(<AccountsReport />)
  await userEvent.click(await screen.findByText('Receipt reconciliation details', { selector: 'summary' }))
  await userEvent.selectOptions(screen.getByLabelText('Receipt method'), 'cash')
  expect(screen.queryByRole('button', { name: 'View original receipt' })).toBeNull()
  await userEvent.selectOptions(screen.getByLabelText('Receipt method'), 'bank')
  await userEvent.click(screen.getByRole('button', { name: 'View original receipt' }))
  const dialog = screen.getByRole('dialog', { name: 'Receipt player statement' })
  const receipt = await within(dialog).findByText('Reference: Earlier transfer')
  expect(receipt.closest('li')).toHaveFocus()
  expect(state.rpc).toHaveBeenLastCalledWith('get_player_account', { p_profile_id: 'player' })
})

test('failed Stripe refund restoration opens the original receipt beyond its intermediate refund', async () => {
  const report = fixture()
  report.receipts = { gross_pence: 0, refunds_pence: 200, reversals_pence: 0, net_pence: 200,
    methods: [{ method: 'stripe', gross_pence: 0, refunds_pence: 200, reversals_pence: 0, net_pence: 200 }],
    entries: [{ id: 'refund-restored', kind: 'reversal', method: 'stripe', profile_id: 'player', player_name: 'Joe Bloggs',
      description: 'Stripe refund failed', occurred_on: '2026-11-24', amount_pence: 200,
      linked_entry_id: 'refund', original_receipt_id: 'receipt', reverses_refund: true }] }
  state.rpc.mockResolvedValueOnce({ data: report }).mockResolvedValue({ data: {
    profile_id: 'player', balance_pence: 3000, entries: [
      { id: 'receipt', kind: 'receipt', description: 'Original Stripe payment', source: 'stripe_payment',
        occurred_on: '2026-11-10', reference: 'pi_original', amount_pence: 3000, running_balance_pence: 3000 },
      { id: 'refund', kind: 'refund', description: 'Stripe refund', source: 'stripe_refund', linked_entry_id: 'receipt',
        occurred_on: '2026-11-12', amount_pence: -200, running_balance_pence: 2800 },
      { id: 'refund-restored', kind: 'reversal', description: 'Stripe refund failed', source: 'reversal', linked_entry_id: 'refund',
        occurred_on: '2026-11-24', amount_pence: 200, running_balance_pence: 3000 },
    ],
  } })
  render(<AccountsReport />)
  const receipts = await screen.findByRole('region', { name: 'Club receipts' })
  expect(receipts).toHaveTextContent('Gross receipts£0.00')
  expect(receipts).toHaveTextContent('Refunds£2.00')
  expect(receipts).toHaveTextContent('Net receipts£2.00')
  await userEvent.click(screen.getByText('Receipt reconciliation details', { selector: 'summary' }))
  await userEvent.click(screen.getByRole('button', { name: 'View original receipt' }))
  const dialog = screen.getByRole('dialog', { name: 'Receipt player statement' })
  const original = await within(dialog).findByText('Reference: pi_original')
  expect(original.closest('li')).toHaveFocus()
  expect(within(dialog).getByText('Stripe refund').closest('li')).not.toHaveFocus()
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
