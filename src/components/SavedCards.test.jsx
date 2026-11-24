import { beforeEach, expect, test, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
const state = vi.hoisted(() => ({ invoke: vi.fn(), auth: {} }))
vi.mock('../lib/supabase', () => ({ supabase: { functions: { invoke: state.invoke } } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => state.auth }))
import SavedCards from './SavedCards'
const cards = [{ id: 'opaque-removal-token-1', brand: 'visa', last4: '4242' }, { id: 'opaque-removal-token-2', brand: 'mastercard', last4: '4444' }]
beforeEach(() => {
  state.auth = { user: { id: 'player' }, profile: { id: 'player', club_id: 'club', is_player: true, approved: true, active: true } }
  state.invoke.mockReset().mockResolvedValue({ data: { cards } })
})
const open = async () => { await userEvent.click(screen.getByText('Saved cards', { selector: 'summary' })); await screen.findByText('Visa ending 4242') }

test('saved cards starts collapsed and fetches only brand and last four for its owner on expansion', async () => {
  render(<SavedCards profileId="player" />)
  expect(screen.getByText('Saved cards').closest('details')).not.toHaveAttribute('open')
  expect(state.invoke).not.toHaveBeenCalled()
  await open()
  expect(screen.getByText('Mastercard ending 4444')).toBeInTheDocument()
  expect(document.body).not.toHaveTextContent('opaque-removal-token')
  expect(state.invoke).toHaveBeenCalledWith('stripe-saved-cards', { body: { action: 'list' } })
})

test('removal needs explicit confirmation; Keep card has no effect and successful remove refreshes list', async () => {
  let removed = false
  state.invoke.mockImplementation(async (_, { body }) => body.action === 'remove' ? (removed = true, { data: { removed: true } }) : { data: { cards: removed ? cards.slice(1) : cards } })
  render(<SavedCards profileId="player" />)
  await open()
  await userEvent.click(screen.getByRole('button', { name: 'Remove Visa ending 4242' }))
  expect(screen.getByRole('group', { name: 'Confirm card removal' })).toHaveTextContent('It will no longer be offered in Checkout')
  expect(state.invoke.mock.calls).toHaveLength(1)
  await userEvent.click(screen.getByRole('button', { name: 'Keep card' }))
  expect(state.invoke.mock.calls).toHaveLength(1)
  await userEvent.click(screen.getByRole('button', { name: 'Remove Visa ending 4242' }))
  await userEvent.click(screen.getByRole('button', { name: 'Remove card', exact: true }))
  expect(await screen.findByText('Visa ending 4242 removed.')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove Visa ending 4242' })).not.toBeInTheDocument())
  expect(state.invoke).toHaveBeenCalledWith('stripe-saved-cards', { body: { action: 'remove', id: 'opaque-removal-token-1', confirmed: true } })
  expect(screen.getByRole('button', { name: 'Remove Mastercard ending 4444' })).toBeInTheDocument()
  expect(state.invoke.mock.calls.every(([name]) => name === 'stripe-saved-cards')).toBe(true)
})

test.each(['other_player', 'supporter', 'unapproved', 'inactive'])('%s cannot display or request saved cards', async reason => {
  if (reason === 'other_player') state.auth.user.id = 'manager'
  if (reason === 'supporter') state.auth.profile.is_player = false
  if (reason === 'unapproved') state.auth.profile.approved = false
  if (reason === 'inactive') state.auth.profile.active = false
  render(<SavedCards profileId="player" />)
  expect(screen.queryByText('Saved cards')).not.toBeInTheDocument()
  expect(state.invoke).not.toHaveBeenCalled()
})

test('owner or account change hides old cards immediately and ignores the previous late list result', async () => {
  let resolveList
  state.invoke.mockReturnValueOnce(new Promise(resolve => { resolveList = resolve })).mockResolvedValue({ data: { cards: [] } })
  const view = render(<SavedCards profileId="player" />)
  await userEvent.click(screen.getByText('Saved cards', { selector: 'summary' }))
  await screen.findByText('Loading saved cards…')
  state.auth = { user: { id: 'next-player' }, profile: { id: 'next-player', club_id: 'next-club', is_player: true, approved: true, active: true } }
  view.rerender(<SavedCards profileId="next-player" />)
  expect(screen.queryByText('Visa ending 4242')).not.toBeInTheDocument()
  await act(async () => resolveList({ data: { cards } }))
  expect(await screen.findByText('No saved cards.')).toBeInTheDocument()
  expect(screen.queryByText('Visa ending 4242')).not.toBeInTheDocument()
})

test('removal failure claims no success and can refresh the actual provider list', async () => {
  state.invoke.mockImplementation(async (_, { body }) => body.action === 'remove' ? { error: new Error('response lost') } : { data: { cards } })
  render(<SavedCards profileId="player" />)
  await open()
  await userEvent.click(screen.getByRole('button', { name: 'Remove Visa ending 4242' }))
  await userEvent.click(screen.getByRole('button', { name: 'Remove card', exact: true }))
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't confirm card removal")
  expect(screen.queryByText('Visa ending 4242 removed.')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Refresh saved cards' }))
  expect(await screen.findByRole('button', { name: 'Remove Visa ending 4242' })).toBeInTheDocument()
})

test('malformed card details are unavailable instead of exposing a full number', async () => {
  state.invoke.mockResolvedValueOnce({ data: { cards: [{ id: 'opaque', brand: 'visa', last4: '4242424242424242' }] } }).mockResolvedValue({ data: { cards: [] } })
  render(<SavedCards profileId="player" />)
  await userEvent.click(screen.getByText('Saved cards', { selector: 'summary' }))
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load saved cards")
  expect(document.body).not.toHaveTextContent('4242424242424242')
  await userEvent.click(screen.getByRole('button', { name: 'Retry saved cards' }))
  expect(await screen.findByText('No saved cards.')).toBeInTheDocument()
})
