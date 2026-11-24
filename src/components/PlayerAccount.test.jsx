import { beforeEach, describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const store = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: store.rpc, functions: { invoke: store.invoke } } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'p1' },
  profile: { id: 'p1', club_id: 'club', is_player: true, approved: true, active: true } }) }))
import PlayerAccount from './PlayerAccount'

const empty = { profile_id: 'p1', balance_pence: 0, entries: [] }
beforeEach(() => { store.rpc.mockReset().mockResolvedValue({ data: empty, error: null }); store.invoke.mockReset() })

describe('Player account', () => {
  test('own Checkout action follows the balance and precedes the statement', async () => {
    store.invoke.mockResolvedValue({ data: { ready: true, can_pay: false, kind: 'balance', amount_pence: 0, balance_pence: 0, min_amount_pence: 30, currency: 'gbp' } })
    render(<MemoryRouter><PlayerAccount profileId="p1" canPay /></MemoryRouter>)
    const action = await screen.findByRole('button', { name: 'Add money' })
    expect(screen.getByText('Settled').compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(action.compareDocumentPosition(screen.getByRole('heading', { name: 'Statement' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('the player can remove their saved card while Checkout is unavailable', async () => {
    store.invoke.mockImplementation(async (name, { body }) => {
      if (name === 'stripe-checkout') return { data: { ready: false, can_pay: false, kind: 'balance',
        amount_pence: 0, balance_pence: 0, min_amount_pence: 30, currency: 'gbp' } }
      if (body.action === 'remove') return { data: { removed: true } }
      return { data: { cards: [{ id: 'own-card', brand: 'visa', last4: '4242' }] } }
    })
    render(<MemoryRouter><PlayerAccount profileId="p1" canPay /></MemoryRouter>)
    await userEvent.click(await screen.findByText('Saved cards', { selector: 'summary' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Visa ending 4242' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove card', exact: true }))
    expect(await screen.findByText('Visa ending 4242 removed.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Add money' })).not.toBeInTheDocument()
  })

  test('confirmed Checkout return refreshes account once without a remount refresh loop', async () => {
    const id = crypto.randomUUID()
    store.invoke.mockImplementation(async (_, { body }) => ({ data: body.action === 'status' ? { attempt_id: id, amount_pence: 1000, currency: 'gbp', status: 'succeeded' } : { ready: false, can_pay: false, kind: 'balance', amount_pence: 0, balance_pence: 0, min_amount_pence: 30, currency: 'gbp' } }))
    render(<MemoryRouter initialEntries={[`/you?payment_attempt=${id}&payment_status=return`]}><PlayerAccount profileId="p1" canPay /></MemoryRouter>)
    await screen.findByText('Payment confirmed: £10.00. Your balance and statement are being refreshed.')
    await waitFor(() => expect(store.rpc.mock.calls.filter(([name]) => name === 'get_player_account')).toHaveLength(2))
  })

  test('initialEntryId focuses a matching transaction once and does not steal focus on refresh', async () => {
    store.rpc.mockResolvedValue({ data: { ...empty, balance_pence: 500, entries: [{ id: 'target-entry', kind: 'receipt', amount_pence: 500, description: 'Target receipt', source: 'cash', occurred_on: '2026-11-24', running_balance_pence: 500 }] } })
    render(<PlayerAccount profileId="p1" initialEntryId="target-entry" />)
    const entry = (await screen.findByText('Target receipt')).closest('li')
    await waitFor(() => expect(entry).toHaveFocus())
    const other = document.createElement('button')
    other.textContent = 'Other control'; document.body.append(other); other.focus()
    fireEvent.focus(window)
    await waitFor(() => expect(store.rpc).toHaveBeenCalledTimes(2))
    await screen.findByText('Target receipt')
    expect(other).toHaveFocus(); other.remove()
  })
  test('empty account is settled with no transactions', async () => {
    render(<PlayerAccount profileId="p1" />)
    expect(await screen.findByText('Settled')).toBeInTheDocument()
    expect(screen.getByText('No transactions yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record receipt' })).not.toBeInTheDocument()
  })

  test('returning to You refreshes the balance changed by a manager elsewhere', async () => {
    render(<PlayerAccount profileId="p1" />)
    expect(await screen.findByText('Settled')).toBeInTheDocument()
    store.rpc.mockResolvedValue({ data: { ...empty, balance_pence: 2000 }, error: null })
    fireEvent.focus(window)
    expect(await screen.findByText('£20.00 in credit')).toBeInTheDocument()
  })

  test('failed account load never shows a false zero and offers recovery', async () => {
    store.rpc.mockResolvedValueOnce({ error: { message: 'offline' } })
    render(<PlayerAccount profileId="p1" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('balance is unavailable')
    expect(screen.queryByText('Settled')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Settled')).toBeInTheDocument()
  })

  test('statement preserves posting order, links, bank reference and running balances in a focusable scroll region', async () => {
    store.rpc.mockResolvedValue({ data: { ...empty, balance_pence: -700, entries: [
      { id: 'later-date', kind: 'receipt', amount_pence: 900, description: 'Bank receipt', source: 'bank', reference: 'BANK-123', occurred_on: '2026-11-24', running_balance_pence: 900 },
      { id: 'earlier-date', kind: 'debit', amount_pence: -1600, description: 'First Team match', source: 'manager', occurred_on: '2026-11-22', linked_entry_id: 'later-date', running_balance_pence: -700 },
    ] }, error: null })
    render(<PlayerAccount profileId="p1" />)
    const region = await screen.findByRole('region', { name: 'Account transactions' })
    expect(region).toHaveAttribute('tabindex', '0')
    expect(region.querySelectorAll('li')[0]).toHaveTextContent('Bank receipt')
    expect(region).toHaveTextContent('Reference: BANK-123')
    const original = region.querySelector('li')
    original.scrollIntoView = vi.fn()
    await userEvent.click(screen.getByRole('button', { name: 'View original transaction' }))
    expect(original.scrollIntoView).toHaveBeenCalled()
    expect(original).toHaveFocus()
    expect(region).toHaveTextContent('£9.00 in credit')
    expect(screen.getAllByText('£7.00 owed')).toHaveLength(2)
  })

  test('uncertain receipt retries the exact stable request, independently of the bank reference', async () => {
    let receiptCalls = 0
    store.rpc.mockImplementation(async name => name === 'record_account_receipt'
      ? (++receiptCalls === 1 ? { error: { message: 'timeout after commit' } } : { data: 'receipt-id', error: null })
      : { data: { ...empty, balance_pence: receiptCalls ? 1300 : 0 }, error: null })
    render(<PlayerAccount profileId="p1" canRecord />)
    await userEvent.click(await screen.findByRole('button', { name: 'Record receipt' }))
    await userEvent.type(screen.getByLabelText('Amount (£)'), '13')
    await userEvent.selectOptions(screen.getByLabelText('Method'), 'bank')
    await userEvent.type(screen.getByLabelText('Bank reference (optional)'), 'Chris 13')
    await userEvent.click(screen.getByRole('button', { name: 'Save receipt' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Retry the same receipt')
    expect(screen.getByLabelText('Amount (£)')).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Retry receipt' }))
    expect(await screen.findByText('Receipt recorded.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('£13.00 in credit')).toBeInTheDocument())
    const requests = store.rpc.mock.calls.filter(([name]) => name === 'record_account_receipt').map(([, payload]) => payload)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(requests[0]).toMatchObject({ p_profile_id: 'p1', p_amount_pence: 1300, p_method: 'bank', p_reference: 'Chris 13' })
    expect(requests[0].p_request_id).toMatch(/^[\da-f-]{36}$/i)
  })

  test('closing and reopening an uncertain receipt resumes its original request', async () => {
    let failed = true
    store.rpc.mockImplementation(async name => name === 'record_account_receipt'
      ? (failed ? { error: { message: 'offline' } } : { data: 'same-receipt', error: null })
      : { data: empty, error: null })
    const view = render(<PlayerAccount profileId="recovery-player" actorId="manager" canRecord />)
    await userEvent.click(await screen.findByRole('button', { name: 'Record receipt' }))
    await userEvent.type(screen.getByLabelText('Amount (£)'), '9')
    await userEvent.click(screen.getByRole('button', { name: 'Save receipt' }))
    await screen.findByRole('alert')
    view.unmount()
    render(<PlayerAccount profileId="recovery-player" actorId="manager" canRecord />)
    await userEvent.click(await screen.findByRole('button', { name: 'Resume receipt' }))
    expect(screen.getByLabelText('Amount (£)')).toHaveValue('9.00')
    expect(screen.getByLabelText('Amount (£)')).toBeDisabled()
    failed = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry receipt' }))
    await screen.findByText('Receipt recorded.')
    const requests = store.rpc.mock.calls.filter(([name]) => name === 'record_account_receipt').map(([, payload]) => payload)
    expect(requests[1]).toEqual(requests[0])
  })

  test.each(['42501', '22023'])('explicit business refusal %s unlocks the form instead of trapping an ambiguous retry', async code => {
    store.rpc.mockImplementation(async name => name === 'record_account_receipt' ? { error: { code } } : { data: empty, error: null })
    render(<PlayerAccount profileId={`refused-${code}`} canRecord />)
    await userEvent.click(await screen.findByRole('button', { name: 'Record receipt' }))
    await userEvent.type(screen.getByLabelText('Amount (£)'), '12')
    await userEvent.click(screen.getByRole('button', { name: 'Save receipt' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Receipt not saved.')
    expect(screen.getByLabelText('Amount (£)')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Save receipt' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Retry receipt' })).not.toBeInTheDocument()
  })

  test('a paused refusal after an ambiguous outcome retains the original request through re-enable', async () => {
    const responses = [{ error: { message: 'response lost after commit' } }, { error: { code: '42501' } }, { data: 'original-receipt', error: null }]
    store.rpc.mockImplementation(async name => name === 'record_account_receipt' ? responses.shift() : { data: empty, error: null })
    render(<PlayerAccount profileId="paused-after-commit" canRecord />)
    await userEvent.click(await screen.findByRole('button', { name: 'Record receipt' }))
    await userEvent.type(screen.getByLabelText('Amount (£)'), '9')
    await userEvent.click(screen.getByRole('button', { name: 'Save receipt' }))
    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: 'Retry receipt' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('accounts may be paused')
    expect(screen.getByLabelText('Amount (£)')).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Retry receipt' }))
    await screen.findByText('Receipt recorded.')
    const requests = store.rpc.mock.calls.filter(([name]) => name === 'record_account_receipt').map(([, payload]) => payload)
    expect(requests).toHaveLength(3)
    expect(requests[1]).toEqual(requests[0])
    expect(requests[2]).toEqual(requests[0])
  })
})
