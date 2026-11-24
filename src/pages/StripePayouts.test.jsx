import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { buildStripePayoutCsv } from '../lib/csv'
import StripePayouts from './StripePayouts'

const state = vi.hoisted(() => ({ invoke: vi.fn(), enabled: true, manager: true }))
vi.mock('../lib/supabase', () => ({ supabase: { functions: { invoke: state.invoke } } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'manager' }, profile: { club_id: 'club' }, isAdmin: state.manager }) }))
vi.mock('../hooks/usePaymentsRelease', () => ({ usePaymentsRelease: () => ({ enabled: state.enabled }) }))

beforeEach(() => { state.invoke.mockReset(); state.manager = true; state.enabled = true })

const payout = {
  payout_id: 'po_sample', status: 'failed', currency: 'gbp', amount_pence: 950, arrival_on: '2026-11-24',
  breakdown: { gross_pence: 1000, refunds_pence: 0, fees_pence: 40, other_pence: 0, net_pence: 960,
    difference_pence: -10, reconciled: false, issues: ['One movement is unresolved.'] },
  lines: [{ balance_transaction_id: 'txn_sample', date: '2026-11-24', type: 'charge', currency: 'gbp',
    player_name: 'Sam', receipt_reference: 'receipt-1', gross_pence: 1000, refunds_pence: 0, fee_pence: 40, net_pence: 960 }],
}

test('failed payouts and unresolved differences stay visible alongside receipts and fees', async () => {
  state.invoke.mockResolvedValue({ data: { from: '2026-11-01', to: '2026-11-24', mode: 'test', payouts: [payout] } })
  render(<MemoryRouter><StripePayouts /></MemoryRouter>)
  await userEvent.click(await screen.findByText(/Failed payout · £9.50/))
  expect(screen.getByText('Reconciliation outstanding')).toBeVisible()
  expect(screen.getByText('-£0.10')).toBeVisible()
  expect(screen.getByText('One movement is unresolved.')).toBeVisible()
  expect(screen.getByText('Sam')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Export payout CSV' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Bank and cash receipts' })).toHaveAttribute('href', '/manage/accounts-report')
  expect(buildStripePayoutCsv([payout])).toContain('Stripe,gbp,10.00,0.00,0.40,9.60,9.50,-0.10')
})

test('foreign payout currency is identified without reporting its totals as pounds', async () => {
  const foreign = { ...payout, currency: 'eur', lines: [], breakdown: { ...payout.breakdown, issues: ['Unsupported payout currency'] } }
  state.invoke.mockResolvedValue({ data: { from: '2026-11-01', to: '2026-11-24', payouts: [foreign] } })
  render(<MemoryRouter><StripePayouts /></MemoryRouter>)
  await userEvent.click(await screen.findByText(/Failed payout · EUR/))
  expect(screen.getByText('Unsupported payout currency')).toBeVisible()
  expect(screen.queryByText(/£/)).not.toBeInTheDocument()
  const row = buildStripePayoutCsv([foreign]).split('\r\n')[1].split(',')
  expect(row.slice(7, 14)).toEqual(['eur', '', '', '', '', '', ''])
  expect(row.at(-1)).toBe('Unsupported payout currency')
})

test('a manual payout shows the bank amount and leaves unavailable component totals blank', async () => {
  const warning = 'Manual payout components cannot be identified automatically'
  const manual = { ...payout, status: 'paid', amount_pence: 123, lines: [], breakdown: {
    component_net_available: false, gross_pence: 0, refunds_pence: 0, fees_pence: 0, net_pence: 0,
    difference_pence: null, reconciled: false, issues: [warning],
  } }
  state.invoke.mockResolvedValue({ data: { from: '2026-11-01', to: '2026-11-24', payouts: [manual] } })
  render(<MemoryRouter><StripePayouts /></MemoryRouter>)
  await userEvent.click(await screen.findByText(/Paid by Stripe · £1.23/))
  expect(screen.getByText(warning)).toBeVisible()
  expect(screen.queryByText('Difference', { exact: true })).not.toBeInTheDocument()
  const row = buildStripePayoutCsv([manual]).split('\r\n')[1].split(',')
  expect(row.slice(7, 14)).toEqual(['gbp', '', '', '', '', '1.23', ''])
  expect(row.at(-1)).toBe(warning)
})

test('a negative provider payout is labelled as a bank debit and exported with its sign', async () => {
  const debit = { ...payout, status: 'paid', amount_pence: -125, lines: [], breakdown: {
    gross_pence: 0, refunds_pence: 125, fees_pence: 0, other_pence: 0, net_pence: -125, difference_pence: 0, reconciled: true,
  } }
  state.invoke.mockResolvedValue({ data: { from: '2026-11-01', to: '2026-11-24', payouts: [debit] } })
  render(<MemoryRouter><StripePayouts /></MemoryRouter>)
  await userEvent.click(await screen.findByText(/Bank debit collected · -£1.25/))
  expect(screen.getByText(/Expected bank debit/)).toBeVisible()
  const row = buildStripePayoutCsv([debit]).split('\r\n')[1].split(',')
  expect(row[3]).toBe('Bank debit total')
  expect(row.slice(11, 14)).toEqual(['-1.25', '-1.25', '0.00'])
})

test('disabled or non-manager access makes no provider request', () => {
  state.manager = false
  render(<MemoryRouter><StripePayouts /></MemoryRouter>)
  expect(screen.getByText('Stripe payouts are unavailable.')).toBeVisible()
  expect(state.invoke).not.toHaveBeenCalled()
})
