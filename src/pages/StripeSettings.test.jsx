import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import StripeSettings from './StripeSettings'

const state = vi.hoisted(() => ({ enabled: true, isAdmin: true, invoke: vi.fn() }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'manager' }, profile: { club_id: 'club' }, isAdmin: state.isAdmin }),
}))
vi.mock('../hooks/usePaymentsRelease', () => ({ usePaymentsRelease: () => ({ enabled: state.enabled }) }))
vi.mock('../lib/supabase', () => ({ supabase: { functions: { invoke: state.invoke } } }))

beforeEach(() => {
  state.enabled = true
  state.isAdmin = true
  state.invoke.mockReset()
})

function openSettings(path = '/manage/settings/stripe') {
  render(<MemoryRouter initialEntries={[path]}><StripeSettings /></MemoryRouter>)
}

test('returning from onboarding displays fresh Stripe status and outstanding requirements', async () => {
  state.invoke.mockResolvedValueOnce({
    data: {
      connected: true, ready: false, mode: 'test', charges_enabled: false,
      requirements: { currently_due: ['external_account', 'representative.first_name'] },
    },
  })
  openSettings('/manage/settings/stripe?stripe=return')
  expect(await screen.findByRole('heading', { name: 'Stripe setup incomplete' })).toBeVisible()
  expect(screen.getByText('Receiving bank account')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Continue Stripe setup' })).toBeVisible()
  expect(state.invoke).toHaveBeenCalledTimes(1)
  expect(state.invoke).toHaveBeenCalledWith('stripe-connect-onboard', { body: { action: 'status' } })

  state.invoke.mockResolvedValueOnce({ data: { connected: true, ready: true, mode: 'test', charges_enabled: true, payouts_enabled: true } })
  await userEvent.click(screen.getByRole('button', { name: 'Check Stripe status' }))
  expect(await screen.findByRole('heading', { name: 'Ready for payments' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Continue Stripe setup' })).toBeNull()
})

test('paused release does not load Stripe status', () => {
  state.enabled = false
  openSettings()
  expect(screen.getByText('Stripe setup is unavailable.')).toBeVisible()
  expect(state.invoke).not.toHaveBeenCalled()
})

test('recover from a failed connection lookup', async () => {
  state.invoke.mockResolvedValueOnce({ error: new Error('unavailable') })
    .mockResolvedValueOnce({ data: { connected: false, ready: false, mode: 'test' } })
  openSettings()
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't check Stripe status.")
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByRole('button', { name: 'Set up Stripe' })).toBeVisible()
})
