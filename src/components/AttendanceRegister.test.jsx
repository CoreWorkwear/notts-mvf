import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
const state = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: state.rpc } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'manager' }, profile: { club_id: 'club' } }) }))
vi.mock('../hooks/usePlayers', () => ({ usePlayers: () => ({ players: [{ id: 'joe', first_name: 'Joe', last_name: 'Bloggs', selected: true }, { id: 'sam', first_name: 'Sam', last_name: 'Lee', availability: 'in' }] }) }))
import AttendanceRegister from './AttendanceRegister'
const register = () => ({ fixture_id: 'fixture', revision: 0, occurrence_fingerprint: 'fixture-date-and-team', can_confirm: true, allow_clear: false, unavailable_reason: null, category: 'first_team', activity_date: '2026-11-01', rate: { id: 'rate', amount_pence: 700, effective_from: '2026-09-01' }, confirmed_profile_ids: [], players: [{ profile_id: 'joe', player_name: 'Joe Bloggs', eligible: true, confirmed: false }, { profile_id: 'sam', player_name: 'Sam Lee', eligible: true, confirmed: false }], confirmed_at: null })
beforeEach(() => { sessionStorage.clear(); state.rpc.mockReset().mockResolvedValue({ data: register() }) })
const view = (fixtureId = 'fixture') => render(<AttendanceRegister fixtureId={fixtureId} onClose={vi.fn()} />)

test('does not preselect availability or selection; only explicitly ticked appearances are posted', async () => {
  let current = register()
  state.rpc.mockImplementation(async (name, payload) => {
    if (name === 'confirm_fixture_appearances') current = { ...current, revision: 1, confirmed_profile_ids: payload.p_profile_ids }
    return { data: current }
  })
  view()
  expect(await screen.findByRole('checkbox', { name: 'Joe Bloggs' })).not.toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Sam Lee' })).not.toBeChecked()
  await userEvent.click(screen.getByRole('checkbox', { name: 'Sam Lee' }))
  await userEvent.click(screen.getByRole('button', { name: 'Save attendance' }))
  expect(await screen.findByText('Attendance saved. Showing the current confirmed appearances.')).toBeInTheDocument()
  const payload = state.rpc.mock.calls.find(([name]) => name === 'confirm_fixture_appearances')[1]
  expect(payload).toMatchObject({ p_fixture_id: 'fixture', p_expected_revision: 0, p_occurrence_fingerprint: 'fixture-date-and-team', p_profile_ids: ['sam'] })
  expect(payload.p_request_id).toMatch(/^[\da-f-]{36}$/i)
})

test('editing shows server-confirmed attendees and keeps waived fees visibly distinct', async () => {
  state.rpc.mockResolvedValue({ data: { ...register(), revision: 4, confirmed_profile_ids: ['sam'], players: [{ profile_id: 'sam', player_name: 'Sam Lee', eligible: true, confirmed: true, waived: true }, { profile_id: 'joe', player_name: 'Joe Bloggs', eligible: true, confirmed: false }] } })
  view()
  expect(await screen.findByRole('checkbox', { name: 'Sam Lee' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Joe Bloggs' })).not.toBeChecked()
  expect(screen.getByText('· Fee waived')).toBeInTheDocument()
})

test('missing rate prevents new appearances while a zero fee is a valid rate', async () => {
  let current = { ...register(), rate: null }
  state.rpc.mockImplementation(async () => ({ data: current }))
  view()
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Joe Bloggs' }))
  expect(screen.getByText('No match fee is set for this date.', { exact: false })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save attendance' })).toBeDisabled()
  current = { ...register(), rate: { id: 'zero', amount_pence: 0 } }
  await userEvent.click(screen.getByRole('button', { name: 'Refresh attendance' }))
  expect(await screen.findByText('£0.00 per appearance', { exact: false })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('checkbox', { name: 'Joe Bloggs' }))
  expect(screen.getByRole('button', { name: 'Save attendance' })).toBeEnabled()
})

test('closed fixture can only clear every existing appearance', async () => {
  state.rpc.mockResolvedValue({ data: { ...register(), can_confirm: false, allow_clear: true, unavailable_reason: 'postponed', confirmed_profile_ids: ['joe', 'sam'] } })
  view()
  await screen.findByRole('checkbox', { name: 'Joe Bloggs' })
  expect(screen.getByRole('button', { name: 'Save attendance' })).toBeDisabled()
  await userEvent.click(screen.getByRole('checkbox', { name: 'Joe Bloggs' }))
  expect(screen.getByRole('button', { name: 'Save attendance' })).toBeDisabled()
  await userEvent.click(screen.getByRole('checkbox', { name: 'Sam Lee' }))
  expect(screen.getByRole('button', { name: 'Save attendance' })).toBeEnabled()
  expect(screen.getByRole('checkbox', { name: 'Joe Bloggs' })).toBeDisabled()
})

test('an unplayed fixture with no previous confirmation cannot save an empty or new register', async () => {
  state.rpc.mockResolvedValue({ data: { ...register(), can_confirm: false, allow_clear: false, unavailable_reason: 'no_result' } })
  view('unplayed-fixture')
  expect(await screen.findByRole('checkbox', { name: 'Joe Bloggs' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Save attendance' })).toBeDisabled()
  expect(screen.getByText(/No match fees can be confirmed/)).toBeInTheDocument()
})

test('stale attendance is not saved and requires an explicit refresh of the current register', async () => {
  let current = register()
  state.rpc.mockImplementation(async name => name === 'confirm_fixture_appearances' ? { error: { code: '40001' } } : { data: current })
  view('stale-fixture')
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Joe Bloggs' }))
  await userEvent.click(screen.getByRole('button', { name: 'Save attendance' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Attendance changed since you opened it')
  expect(screen.getByRole('button', { name: 'Save attendance' })).toBeDisabled()
  current = { ...register(), revision: 1, confirmed_profile_ids: ['sam'] }
  await userEvent.click(screen.getByRole('button', { name: 'Refresh attendance' }))
  expect(await screen.findByRole('checkbox', { name: 'Sam Lee' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Joe Bloggs' })).not.toBeChecked()
  expect(screen.queryByText('Attendance saved.', { exact: false })).not.toBeInTheDocument()
})

test('ambiguous attendance survives close and a paused refusal with an identical revision, fingerprint and ID', async () => {
  const outcomes = [{ error: { message: 'response lost' } }, { error: { code: '42501' } }, { data: { ...register(), revision: 1, confirmed_profile_ids: ['sam'] } }]
  state.rpc.mockImplementation(async name => name === 'confirm_fixture_appearances' ? outcomes.shift() : { data: register() })
  const first = view('ambiguous-fixture')
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Sam Lee' }))
  await userEvent.click(screen.getByRole('button', { name: 'Save attendance' }))
  await screen.findByRole('alert')
  first.unmount(); view('ambiguous-fixture')
  await userEvent.click(await screen.findByRole('button', { name: 'Retry attendance' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('may be paused')
  expect(screen.getByRole('checkbox', { name: 'Sam Lee' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Retry attendance' }))
  await screen.findByText('Attendance saved. Showing the current confirmed appearances.')
  const payloads = state.rpc.mock.calls.filter(([name]) => name === 'confirm_fixture_appearances').map(([, payload]) => payload)
  expect(payloads).toHaveLength(3); expect(payloads[1]).toEqual(payloads[0]); expect(payloads[2]).toEqual(payloads[0])
})

test('failed read offers retry without an editable blank register', async () => {
  state.rpc.mockRejectedValueOnce(new Error('offline'))
  view()
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load attendance")
  expect(screen.queryByRole('button', { name: 'Save attendance' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(2))
})

const trainingRegister = () => ({ ...register(), fixture_id: undefined, session_id: 'session-1', category: 'training', rate: { id: 'training-rate', amount_pence: 400 }, occurrence_revision: 2 })
const trainingView = (sessionId = 'session-1') => render(<AttendanceRegister mode="training" sessionId={sessionId} onClose={vi.fn()} />)

test('training uses its own occurrence API and never defaults from an advance reply; next series date is separate', async () => {
  const occurrences = { 'session-1': trainingRegister(), 'session-2': { ...trainingRegister(), session_id: 'session-2' } }
  state.rpc.mockImplementation(async (name, payload) => {
    if (name === 'confirm_training_attendance') occurrences[payload.p_session_id] = { ...occurrences[payload.p_session_id], revision: 1, confirmed_profile_ids: payload.p_profile_ids }
    return { data: occurrences[payload.p_session_id] }
  })
  const first = trainingView()
  expect(await screen.findByRole('checkbox', { name: 'Sam Lee' })).not.toBeChecked()
  expect(screen.getByText('£4.00 per attendee', { exact: false })).toBeInTheDocument()
  expect(screen.getByText('Tick only players who actually attended. Advance replies do not confirm attendance.')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('checkbox', { name: 'Joe Bloggs' }))
  await userEvent.click(screen.getByRole('button', { name: 'Save attendance' }))
  await screen.findByText('Attendance saved. Showing the current confirmed attendees.')
  const payload = state.rpc.mock.calls.find(([name]) => name === 'confirm_training_attendance')[1]
  expect(payload).toMatchObject({ p_session_id: 'session-1', p_profile_ids: ['joe'], p_expected_revision: 0 })
  expect(payload).not.toHaveProperty('p_fixture_id')
  first.unmount(); trainingView('session-2')
  expect(await screen.findByRole('checkbox', { name: 'Joe Bloggs' })).not.toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Sam Lee' })).not.toBeChecked()
  expect(state.rpc).toHaveBeenLastCalledWith('get_training_attendance_register', { p_session_id: 'session-2' })
})

test('training cancellation after opening reports stale and refreshes into a closed register', async () => {
  let current = trainingRegister()
  state.rpc.mockImplementation(async name => name === 'confirm_training_attendance' ? { error: { code: '40001' } } : { data: current })
  trainingView('training-stale')
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Sam Lee' }))
  await userEvent.click(screen.getByRole('button', { name: 'Save attendance' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Refresh attendance')
  current = { ...trainingRegister(), can_confirm: false, allow_clear: false, unavailable_reason: 'cancelled' }
  await userEvent.click(screen.getByRole('button', { name: 'Refresh attendance' }))
  expect(await screen.findByRole('checkbox', { name: 'Sam Lee' })).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Save attendance' })).toBeDisabled()
  expect(screen.getByText(/This session cannot gain new attendees: cancelled/)).toBeInTheDocument()
  expect(screen.queryByText('Attendance saved.', { exact: false })).not.toBeInTheDocument()
})

test('training ambiguous retry preserves its own session request after closing', async () => {
  let writeCount = 0
  state.rpc.mockImplementation(async name => name === 'confirm_training_attendance' ? (++writeCount === 1 ? { error: { message: 'response lost' } } : { data: { ...trainingRegister(), confirmed_profile_ids: ['joe'], revision: 1 } }) : { data: trainingRegister() })
  const first = trainingView('training-retry')
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Joe Bloggs' }))
  await userEvent.click(screen.getByRole('button', { name: 'Save attendance' }))
  await screen.findByRole('alert')
  first.unmount(); trainingView('training-retry')
  await userEvent.click(await screen.findByRole('button', { name: 'Retry attendance' }))
  await screen.findByText('Attendance saved. Showing the current confirmed attendees.')
  const payloads = state.rpc.mock.calls.filter(([name]) => name === 'confirm_training_attendance').map(([, payload]) => payload)
  expect(payloads).toHaveLength(2); expect(payloads[1]).toEqual(payloads[0])
})
