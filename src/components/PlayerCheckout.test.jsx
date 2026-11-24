import { beforeEach, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
const state = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { functions: { invoke: state.invoke } } }))
import PlayerCheckout, { PlayerCheckoutReturn, safeCheckoutUrl } from './PlayerCheckout'
const quote = overrides => ({ ready: true, can_pay: false, kind: 'balance', amount_pence: 0, balance_pence: 0, min_amount_pence: 30, currency: 'gbp', ...overrides })
const debt = quote({ can_pay: true, balance_pence: -900, amount_pence: 900 })
let profileId
beforeEach(() => { sessionStorage.clear(); profileId = crypto.randomUUID(); state.invoke.mockReset().mockResolvedValue({ data: quote() }) })
const view = (props = {}, path = '/you') => render(<MemoryRouter initialEntries={[path]}><PlayerCheckout profileId={profileId} {...props} /></MemoryRouter>)
const hosted = request => ({ data: { attempt_id: request.attempt_id, amount_pence: request.amount_pence, currency: 'gbp', status: 'pending', checkout_url: 'https://checkout.stripe.com/c/pay/session' } })

test('unready backend hides payment actions', async () => {
  state.invoke.mockResolvedValue({ data: quote({ ready: false, balance_pence: -900 }) })
  view()
  await waitFor(() => expect(state.invoke).toHaveBeenCalled())
  expect(screen.queryByRole('button', { name: 'Pay balance' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Add money' })).not.toBeInTheDocument()
})

test('arrears makes Pay balance primary and fresh review needs explicit confirmation', async () => {
  state.invoke.mockResolvedValue({ data: debt })
  view()
  const pay = await screen.findByRole('button', { name: 'Pay balance' })
  expect(pay).toHaveClass('btn-primary')
  expect(screen.getByRole('button', { name: 'Add money' })).toHaveClass('btn-ghost')
  await userEvent.click(pay)
  expect(await screen.findByText('Amount: £9.00')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Continue to secure Checkout' })).toBeInTheDocument()
  expect(state.invoke.mock.calls.every(([, { body }]) => body.action === 'quote')).toBe(true)
})

test('small arrears explain the online minimum without silently increasing the payment', async () => {
  state.invoke.mockResolvedValue({ data: quote({ balance_pence: -10, amount_pence: 10 }) })
  view()
  await userEvent.click(await screen.findByRole('button', { name: 'Pay balance' }))
  expect(await screen.findByText(/below the £0.30 online payment minimum/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Continue to secure Checkout' })).not.toBeInTheDocument()
  expect(state.invoke.mock.calls.some(([, { body }]) => body.action === 'start')).toBe(false)
})

test('positive supported top-up quotes before opening allowlisted hosted Checkout', async () => {
  const redirect = vi.fn()
  state.invoke.mockImplementation(async (_, { body }) => body.action === 'start' ? hosted(body) : { data: quote(body.kind === 'top_up' ? { kind: 'top_up', amount_pence: body.amount_pence, can_pay: true } : {}) })
  view({ redirect })
  const add = await screen.findByRole('button', { name: 'Add money' })
  expect(add).toHaveClass('btn-primary')
  await userEvent.click(add)
  await userEvent.type(screen.getByLabelText('Amount to add (£)'), '0.001')
  await userEvent.click(screen.getByRole('button', { name: 'Review amount' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Enter at least £0.30')
  await userEvent.clear(screen.getByLabelText('Amount to add (£)'))
  await userEvent.type(screen.getByLabelText('Amount to add (£)'), '30')
  await userEvent.click(screen.getByRole('button', { name: 'Review amount' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Continue to secure Checkout' }))
  expect(redirect).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/session')
  const start = state.invoke.mock.calls.find(([, { body }]) => body.action === 'start')[1].body
  expect(start).toMatchObject({ kind: 'top_up', amount_pence: 3000 })
})

test('stale quote replaces the rejected attempt only after a new explicit authorisation', async () => {
  let starts = 0
  const redirect = vi.fn()
  state.invoke.mockImplementation(async (_, { body }) => body.action === 'start' ? (++starts === 1 ? { error: { context: { json: async () => ({ code: 'stale_quote', quote: { ...debt, amount_pence: 700, balance_pence: -700 } }) } } } : hosted(body)) : { data: debt })
  view({ redirect })
  await userEvent.click(await screen.findByRole('button', { name: 'Pay balance' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Continue to secure Checkout' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Review the new amount and confirm again')
  expect(screen.getByText('Amount: £7.00')).toBeInTheDocument()
  expect(starts).toBe(1)
  expect(redirect).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Continue to secure Checkout' }))
  const requests = state.invoke.mock.calls.filter(([, { body }]) => body.action === 'start').map(([, { body }]) => body)
  expect(requests[1].amount_pence).toBe(700)
  expect(requests[1].attempt_id).not.toBe(requests[0].attempt_id)
})

test('uncertain Checkout creation reuses identical attempt and payload after reopening You', async () => {
  let starts = 0
  state.invoke.mockImplementation(async (_, { body }) => body.action === 'start' ? (++starts === 1 ? { error: new Error('network lost') } : hosted(body)) : { data: debt })
  const first = view({ redirect: vi.fn() })
  await userEvent.click(await screen.findByRole('button', { name: 'Pay balance' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Continue to secure Checkout' }))
  await screen.findByRole('alert')
  first.unmount()
  view({ redirect: vi.fn() })
  await userEvent.click(await screen.findByRole('button', { name: 'Retry Checkout' }))
  const requests = state.invoke.mock.calls.filter(([, { body }]) => body.action === 'start').map(([, { body }]) => body)
  expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0])
})

test.each(['http://checkout.stripe.com/pay', 'https://checkout.stripe.com.evil.test/pay', 'https://user@checkout.stripe.com/pay', 'https://evil.test/pay', 'javascript:alert(1)'])('rejects non-allowlisted destination %s', value => {
  expect(safeCheckoutUrl(value)).toBeNull()
})

test('return and cancellation parameters only read own server status and never post a receipt', async () => {
  const id = crypto.randomUUID()
  const onStatus = vi.fn()
  state.invoke.mockResolvedValue({ data: { attempt_id: id, amount_pence: 900, currency: 'gbp', status: 'pending' } })
  view({ statusOnly: true, onStatus }, `/you?payment_attempt=${id}&payment_status=cancelled`)
  expect(await screen.findByText('Payment pending. Your balance changes only after payment is confirmed.')).toBeInTheDocument()
  expect(screen.getByText('You returned from Checkout. This does not confirm a payment.')).toBeInTheDocument()
  expect(state.invoke).toHaveBeenCalledWith('stripe-checkout', { body: { action: 'status', attempt_id: id } })
  expect(onStatus).toHaveBeenCalledWith(id, 'pending')
  expect(screen.queryByRole('button', { name: 'Add money' })).not.toBeInTheDocument()
  expect(screen.queryByText('Payment confirmed:', { exact: false })).not.toBeInTheDocument()
})

test('legacy status-only return still shows verified settlement while payment actions stay hidden', async () => {
  const id = crypto.randomUUID()
  state.invoke.mockResolvedValue({ data: { attempt_id: id, amount_pence: 2000, currency: 'gbp', status: 'succeeded' } })
  render(<MemoryRouter initialEntries={[`/you?payment_attempt=${id}&payment_status=return`]}><PlayerCheckoutReturn profileId={profileId} /></MemoryRouter>)
  expect(await screen.findByText('Payment confirmed: £20.00.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Add money' })).not.toBeInTheDocument()
})

test('legacy pending return checks status again when the phone regains focus', async () => {
  const id = crypto.randomUUID()
  state.invoke.mockResolvedValueOnce({ data: { attempt_id: id, amount_pence: 900, currency: 'gbp', status: 'pending' } }).mockResolvedValue({ data: { attempt_id: id, amount_pence: 900, currency: 'gbp', status: 'succeeded' } })
  view({ statusOnly: true }, `/you?payment_attempt=${id}&payment_status=return`)
  await screen.findByText('Payment pending. Your balance changes only after payment is confirmed.')
  fireEvent.focus(window)
  expect(await screen.findByText('Payment confirmed: £9.00.')).toBeInTheDocument()
  expect(state.invoke.mock.calls.every(([, { body }]) => body.action === 'status')).toBe(true)
})
