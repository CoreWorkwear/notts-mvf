import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import StripePayouts from './StripePayouts'

const state = vi.hoisted(() => ({ invoke: vi.fn(), enabled: true, manager: true }))
vi.mock('../lib/supabase', () => ({ supabase: { functions: { invoke: state.invoke } } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'manager' }, profile: { club_id: 'club' }, isAdmin: state.manager }) }))
vi.mock('../hooks/usePaymentsRelease', () => ({ usePaymentsRelease: () => ({ enabled: state.enabled }) }))

beforeEach(() => { state.invoke.mockReset(); state.manager = true; state.enabled = true })

const payout = {
  payout_id: 'po_sample', status: 'failed', amount_pence: 950, arrival_on: '2026-11-24',
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
})

test('disabled or non-manager access makes no provider request', () => {
  state.manager = false
  render(<MemoryRouter><StripePayouts /></MemoryRouter>)
  expect(screen.getByText('Stripe payouts are unavailable.')).toBeVisible()
  expect(state.invoke).not.toHaveBeenCalled()
})
