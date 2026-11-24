import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter } from 'react-router-dom'
const mock = vi.hoisted(() => ({ auth: {}, state: {}, create: vi.fn(), reply: vi.fn(), count: vi.fn(), change: vi.fn() }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => mock.auth }))
vi.mock('../hooks/useTraining', () => ({ useTraining: () => mock.state, createTrainingSessions: mock.create, replyToTraining: mock.reply, getTrainingHeadcount: mock.count, changeTrainingSession: mock.change }))
vi.mock('../components/TrainingNoticeInbox', () => ({ default: () => null }))
const release = vi.hoisted(() => ({ enabled: false }))
vi.mock('../hooks/usePaymentsRelease', () => ({ usePaymentsRelease: () => release }))
vi.mock('../components/AttendanceRegister', () => ({ default: ({ mode, sessionId, onClose }) => <section aria-label="Training attendance">{mode} register for {sessionId}<button onClick={onClose}>Cancel attendance</button></section> }))
import Training from './Training'
const session = { id: 's1', start_date: '2030-10-21', start_time: '19:00:00', venue: 'Club pitch', town: 'Nottingham', audience: 'club', focus: 'Passing', canReply: true, openForReplies: true, revision: 1 }
function mount(path = '/training?session=s1') { return render(<MemoryRouter initialEntries={[path]}><Training /></MemoryRouter>) }
beforeEach(() => {
  vi.clearAllMocks()
  release.enabled = false
  mock.auth = { isAdmin: false, managerView: false }
  mock.state = { sessions: [{ ...session }], replies: { s1: 'in' }, loading: false, error: null, reload: vi.fn(async () => ({ sessions: mock.state.sessions, replies: mock.state.replies })) }
  mock.change.mockResolvedValue(); mock.create.mockResolvedValue('s2'); mock.reply.mockResolvedValue(); mock.count.mockResolvedValue([])
})

test('manager opens actual attendance inline separately from advance replies only when accounts enabled', async () => {
  mock.auth = { isAdmin: true, managerView: true }
  release.enabled = true
  mount()
  const dialog = await screen.findByRole('dialog', { name: 'Training session' })
  expect(within(dialog).getByRole('button', { name: 'In', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(screen.getByRole('button', { name: 'Confirm who attended' }))
  expect(screen.getByRole('region', { name: 'Training attendance' })).toHaveTextContent('training register for s1')
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(mock.reply).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Cancel attendance' }))
  expect(screen.queryByRole('region', { name: 'Training attendance' })).not.toBeInTheDocument()
  expect(screen.getByRole('dialog', { name: 'Training session' })).toBeInTheDocument()
})

test('disabled club hides training attendance action for managers', async () => {
  mock.auth = { isAdmin: true, managerView: true }
  mount()
  await screen.findByRole('dialog', { name: 'Training session' })
  expect(screen.queryByRole('button', { name: 'Confirm who attended' })).not.toBeInTheDocument()
})
test('opens the exact occurrence by deep link and changes only its reply', async () => {
  mount()
  const dialog = await screen.findByRole('dialog', { name: 'Training session' })
  expect(within(dialog).getByRole('button', { name: 'In' })).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Maybe' }))
  expect(mock.reply).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }), 'maybe')
  expect(mock.state.reload).toHaveBeenCalledTimes(2)
})
test('keeps failed replies visible with recovery copy', async () => {
  mock.reply.mockRejectedValue(new Error('Check your connection and try again.'))
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Out', exact: true }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Reply was not saved')
  expect(screen.getByRole('button', { name: 'In', exact: true })).toHaveAttribute('aria-pressed', 'true')
})
test('cancelled sessions retain their recorded reply and close controls', async () => {
  mock.state.sessions[0].cancelled = true
  mount()
  const dialog = await screen.findByRole('dialog', { name: 'Training session' })
  expect(within(dialog).getByRole('status')).toHaveTextContent('Your reply: In')
  expect(within(dialog).queryByRole('button', { name: 'Out' })).not.toBeInTheDocument()
})
test('does not reveal an inaccessible deep link', async () => {
  mock.state.sessions = []
  mount()
  expect(await screen.findByText('This session is unavailable for your account.')).toBeInTheDocument()
  expect(screen.queryByText('Passing')).not.toBeInTheDocument()
})
test('manager headcount groups all names including No reply', async () => {
  mock.auth = { isAdmin: true, managerView: true }
  mock.count.mockResolvedValue([{ profile_id: 'p1', first_name: 'Alex', last_name: 'Smith', status: 'in' }, { profile_id: 'p2', first_name: 'Sam', last_name: 'Jones', status: null }])
  mount()
  expect(await screen.findByText('Alex Smith')).toBeInTheDocument()
  expect(screen.getByText('Sam Jones')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'No reply 1' })).toBeInTheDocument()
})
test('manager can retry headcount failures', async () => {
  mock.auth = { isAdmin: true, managerView: true }
  mock.count.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([])
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Retry headcount' }))
  await waitFor(() => expect(mock.count).toHaveBeenCalledTimes(2))
})
async function bookingForm() {
  mock.auth = { isAdmin: true, managerView: true }
  mount('/training')
  await userEvent.click(screen.getByRole('button', { name: 'Book training' }))
  const dialog = await screen.findByRole('dialog', { name: 'Book training' })
  const form = within(dialog)
  const user = userEvent.setup()
  fireEvent.change(form.getByLabelText('Date'), { target: { value:'2030-10-21' } })
  await user.type(form.getByLabelText('Venue'), 'Club pitch')
  await user.type(form.getByLabelText('Town'), 'Nottingham')
  return { form, user, publish: form.getByRole('button', { name:'Publish training' }) }
}

test('one session is the default and optional directions pass through to the booking', async () => {
  const { form, user, publish } = await bookingForm()
  expect(form.getByRole('checkbox', { name:'Recurring' })).not.toBeChecked()
  expect(form.queryByLabelText('Frequency')).toBeNull()
  await user.type(form.getByLabelText('Address'), '41 Pitch Lane')
  await user.type(form.getByLabelText('Postcode'), 'ng2 5fj')
  await user.type(form.getByLabelText('what3words'), '///one.two.three')
  await user.click(publish)
  expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({
    recurrence:null, address:'41 Pitch Lane', postcode:'ng2 5fj', w3w:'///one.two.three',
  }))
})

test('manager publishes a fortnightly Mon/Wed series through the inclusive end and retains its request ID on retry', async () => {
  mock.create.mockRejectedValueOnce(Object.assign(new Error('Try again.'), { code: '40001' })).mockResolvedValueOnce('s2')
  const { form, user, publish } = await bookingForm()
  await user.click(form.getByRole('checkbox', { name:'Recurring' }))
  expect(form.getByRole('checkbox', { name:'Monday' })).toBeChecked()
  await user.click(form.getByRole('checkbox', { name:'Wednesday' }))
  fireEvent.change(form.getByLabelText('Repeat every'), { target:{ value:'2' } })
  await user.click(form.getByRole('radio', { name:'On date' }))
  fireEvent.change(form.getByLabelText('End date'), { target: { value:'2030-11-18' } })
  expect(form.getByText(/Every 2 weeks on Mon, Wed/)).toHaveTextContent('5 sessions')
  await user.click(publish)
  expect(await form.findByRole('alert')).toHaveTextContent('Training was not saved')
  await user.click(publish)
  await waitFor(() => expect(mock.create).toHaveBeenCalledTimes(2))
  expect(mock.create.mock.calls[0][0]).toMatchObject({ date:'2030-10-21', audience:'club',
    recurrence:{ frequency:'week', interval:2, weekdays:[1,3], until:'2030-11-18', count:null } })
  expect(mock.create.mock.calls[1][0].requestId).toBe(mock.create.mock.calls[0][0].requestId)
})

test('default weekday follows the start date until the manager picks weekdays', async () => {
  const { form, user, publish } = await bookingForm()
  await user.click(form.getByRole('checkbox', { name:'Recurring' }))
  const wed = form.getByRole('checkbox', { name:'Wednesday' })
  fireEvent.change(form.getByLabelText('Date'), { target:{value:'2030-10-23'} })
  expect(wed).toBeChecked()
  const fri = form.getByRole('checkbox', { name:'Friday' })
  await user.click(fri)
  fireEvent.change(form.getByLabelText('Date'), { target:{value:'2030-10-24'} })
  expect(wed).toBeChecked()
  expect(fri).toBeChecked()
  expect(form.getByRole('checkbox', { name:'Thursday' })).not.toBeChecked()
  expect(form.getByText(/Every week on Wed, Fri/)).toHaveTextContent('From Fri 25 Oct 2030')
  fireEvent.change(form.getByLabelText('Number of sessions'), { target:{value:'3'} })
  await user.click(publish)
  expect(mock.create.mock.calls[0][0].recurrence).toEqual({ frequency:'week', interval:1, weekdays:[3,5], count:3, until:null })
})

test('empty weekday selections and date ranges without an occurrence cannot publish', async () => {
  const { form, user, publish } = await bookingForm()
  await user.click(form.getByRole('checkbox', { name:'Recurring' }))
  await user.click(form.getByRole('checkbox', { name:'Monday' }))
  await user.click(publish)
  expect(await form.findByRole('alert')).toHaveTextContent('Choose at least one weekday')
  await user.click(form.getByRole('checkbox', { name:'Thursday' }))
  await user.click(form.getByRole('radio', { name:'On date' }))
  fireEvent.change(form.getByLabelText('End date'), { target:{value:'2030-10-23'} })
  await user.click(publish)
  expect(await form.findByRole('alert')).toHaveTextContent('No selected weekday')
  fireEvent.change(form.getByLabelText('Date'), { target:{value:'103000-10-21'} })
  await user.click(form.getByRole('radio', { name:'After' }))
  await user.click(publish)
  expect(await form.findByRole('alert')).toHaveTextContent('Choose a valid start date')
  expect(mock.create).not.toHaveBeenCalled()
})

test('changing frequency and end mode excludes hidden values; leap-year behaviour is visible', async () => {
  const { form, user, publish } = await bookingForm()
  fireEvent.change(form.getByLabelText('Date'), { target:{value:'2032-02-29'} })
  await user.click(form.getByRole('checkbox', { name:'Recurring' }))
  await user.selectOptions(form.getByLabelText('Frequency'), 'year')
  expect(form.queryByRole('checkbox', { name:'Monday' })).toBeNull()
  await user.click(form.getByRole('radio', { name:'On date' }))
  fireEvent.change(form.getByLabelText('End date'), { target:{value:'2036-02-29'} })
  expect(form.getByText(/Every year on 29 February/)).toHaveTextContent('2 sessions')
  expect(form.getByText(/Leap years only/)).toBeVisible()
  await user.click(form.getByRole('radio', { name:'After' }))
  fireEvent.change(form.getByLabelText('Number of sessions'), { target:{value:'2'} })
  await user.click(publish)
  expect(mock.create.mock.calls[0][0].recurrence).toEqual({ frequency:'year', interval:1, weekdays:[], until:null, count:2 })
})

test('date-ended months skip missing dates and a series over the session limit cannot publish', async () => {
  const { form, user, publish } = await bookingForm()
  fireEvent.change(form.getByLabelText('Date'), { target:{value:'2030-10-31'} })
  await user.click(form.getByRole('checkbox', { name:'Recurring' }))
  await user.selectOptions(form.getByLabelText('Frequency'), 'month')
  await user.click(form.getByRole('radio', { name:'On date' }))
  fireEvent.change(form.getByLabelText('End date'), { target:{value:'2030-12-31'} })
  expect(form.getByText(/Every month on day 31/)).toHaveTextContent('2 sessions')
  await user.selectOptions(form.getByLabelText('Frequency'), 'day')
  fireEvent.change(form.getByLabelText('End date'), { target:{value:'2035-12-31'} })
  await user.click(publish)
  expect(await form.findByRole('alert')).toHaveTextContent('up to 500 sessions')
  expect(mock.create).not.toHaveBeenCalled()
})
test('editing one occurrence preserves availability and uses its revision', async () => {
  mock.auth = { isAdmin: true, managerView: true }
  mock.state.sessions[0] = { ...session, address:'Old road', postcode:'NG1 2AB', w3w:'///one.two.three' }
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Edit session' }))
  const editor = await screen.findByRole('dialog', { name: 'Edit training' })
  expect(within(editor).queryByRole('checkbox', { name:'Recurring' })).toBeNull()
  expect(within(editor).getByLabelText('Address')).toHaveValue('Old road')
  expect(within(editor).getByLabelText('Postcode')).toHaveValue('NG1 2AB')
  expect(within(editor).getByLabelText('what3words')).toHaveValue('///one.two.three')
  await userEvent.clear(within(editor).getByLabelText('Venue'))
  await userEvent.type(within(editor).getByLabelText('Venue'), 'New pitch')
  await userEvent.click(within(editor).getByRole('button', { name: 'Save changes' }))
  expect(mock.change).toHaveBeenCalledWith(expect.objectContaining({ id: 's1', revision: 1 }), expect.objectContaining({ venue: 'New pitch', date: session.start_date, cancel: false }))
  expect(mock.reply).not.toHaveBeenCalled()
  expect(mock.create).not.toHaveBeenCalled()
})
test('cancellation requires deliberate confirmation and keeps saved reply', async () => {
  mock.auth = { isAdmin: true, managerView: true }
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel session' }))
  expect(mock.change).not.toHaveBeenCalled()
  expect(screen.getByText(/Saved replies will be retained/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }))
  expect(mock.change).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }), expect.objectContaining({ cancel: true }))
  expect(mock.reply).not.toHaveBeenCalled()
})
test('cancellation errors retain confirmation and stable retry identity', async () => {
  mock.auth = { isAdmin: true, managerView: true }
  mock.change.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue()
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel session' }))
  await userEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Cancellation was not saved')
  await userEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }))
  expect(mock.change.mock.calls[0][1].requestId).toBe(mock.change.mock.calls[1][1].requestId)
})

test('a notice link to the same occurrence reopens its sheet after closing', async () => {
  render(<MemoryRouter initialEntries={['/training?session=s1']}><Link to="/training?session=s1">Notice availability</Link><Training /></MemoryRouter>)
  const detail = await screen.findByRole('dialog', { name: 'Training session' })
  await userEvent.click(within(detail).getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('link', { name: 'Notice availability' }))
  expect(await screen.findByRole('dialog', { name: 'Training session' })).toBeInTheDocument()
})

test('notice entry waits for fresh revision before allowing a reply', async () => {
  let finish
  mock.state.reload = vi.fn(() => new Promise(resolve => { finish = resolve }))
  mount()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Refreshing session')
  mock.state.sessions = [{ ...session, revision: 2, venue: 'Moved pitch' }]
  await act(async () => finish({ sessions: mock.state.sessions, replies: mock.state.replies }))
  const detail = await screen.findByRole('dialog', { name: 'Training session' })
  expect(within(detail).getByText('Moved pitch, Nottingham')).toBeInTheDocument()
  await userEvent.click(within(detail).getByRole('button', { name: 'Out' }))
  expect(mock.reply).toHaveBeenCalledWith(expect.objectContaining({ id: 's1', revision: 2 }), 'out')
})
test('failed notice refresh hides stale details and offers retry', async () => {
  mock.state.reload.mockResolvedValueOnce(false).mockImplementation(async () => ({ sessions: mock.state.sessions, replies: mock.state.replies }))
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Retry session' }))
  expect(await screen.findByRole('dialog', { name: 'Training session' })).toBeInTheDocument()
})
test('a stale reply refreshes the session before retry', async () => {
  mock.reply.mockImplementationOnce(async () => {
    mock.state.sessions = [{ ...session, revision: 2 }]
    throw Object.assign(new Error('Changed'), { code: '40001' })
  })
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Out', exact: true }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Session changed')
  await userEvent.click(screen.getByRole('button', { name: 'Out', exact: true }))
  expect(mock.reply.mock.calls[1][0].revision).toBe(2)
})

test('editor conflict keeps the draft and retries with the refreshed revision', async () => {
  mock.auth = { isAdmin: true, managerView: true }
  mock.change.mockImplementationOnce(async () => {
    mock.state.sessions = [{ ...session, revision: 2, venue: 'Other pitch' }]
    throw Object.assign(new Error('Changed'), { code: '40001' })
  })
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Edit session' }))
  const editor = await screen.findByRole('dialog', { name: 'Edit training' })
  await userEvent.clear(within(editor).getByLabelText('Venue'))
  await userEvent.type(within(editor).getByLabelText('Venue'), 'My draft pitch')
  await userEvent.click(within(editor).getByRole('button', { name: 'Save changes' }))
  expect(await within(editor).findByRole('alert')).toHaveTextContent('Your changes have been kept')
  expect(within(editor).getByLabelText('Venue')).toHaveValue('My draft pitch')
  expect(within(editor).getByText(/Latest session:.*Other pitch/)).toBeInTheDocument()
  await userEvent.click(within(editor).getByRole('button', { name: 'Save changes' }))
  expect(mock.change.mock.calls[1][0].revision).toBe(2)
  expect(mock.change.mock.calls[1][1].venue).toBe('My draft pitch')
})
