import { beforeEach, describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TrainingNoticeInbox, { TrainingNoticeBanner } from './TrainingNoticeInbox'

const fixture = vi.hoisted(() => ({ auth: {}, rows: [] }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => fixture.auth }))
vi.mock('../lib/supabase', () => ({
  supabase: { from: () => ({
    select() { return this }, eq() { return this }, order() { return this },
    limit: count => Promise.resolve({ data: fixture.rows.slice(0, count) }),
  }) },
}))

const session = { id: 'session-2', start_date: '2099-11-22', start_time: '18:30', audience: 'community' }
const moved = { id: 'event-1', kind: 'moved', title: 'Training moved', body: 'New Ground, Beeston', training_sessions: session }
const panel = element => render(<MemoryRouter>{element}</MemoryRouter>)

beforeEach(() => {
  localStorage.clear()
  fixture.auth = { user: { id: 'member-1' }, profile: { club_id: 'club-1', active: true, approved: true, is_player: true }, teamKeys: ['community'] }
  fixture.rows = [moved]
})

describe('Training notices', () => {
  test('an invited player opens the exact moved session from the notice', async () => {
    panel(<TrainingNoticeInbox />)
    expect(await screen.findByRole('link', { name: 'Update your availability' })).toHaveAttribute('href', '/training?session=session-2')
  })

  test.each(['supporter', 'other squad', 'started', 'cancelled', 'hidden session'])('%s can read the notice without a reply action', async mode => {
    if (mode === 'supporter') fixture.auth.profile.is_player = false
    if (mode === 'other squad') fixture.auth.teamKeys = ['xl']
    if (mode === 'started') fixture.rows = [{ ...moved, training_sessions: { ...session, start_date: '2001-01-01' } }]
    if (mode === 'cancelled') fixture.rows = [{ ...moved, training_sessions: { ...session, cancelled: true } }]
    if (mode === 'hidden session') fixture.rows = [{ ...moved, training_sessions: null }]
    panel(<TrainingNoticeInbox />)
    expect(await screen.findByText('New Ground, Beeston')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Update your availability' })).toBeNull()
  })

  test('dismissing a move does not suppress a later cancellation', async () => {
    const first = panel(<TrainingNoticeBanner />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('complementary')).toBeNull()
    first.unmount()
    fixture.rows = [{ ...moved, id: 'event-2', kind: 'cancelled', title: 'Training cancelled' }]
    panel(<TrainingNoticeBanner />)
    expect(await screen.findByText('Training cancelled')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Update your availability' })).toBeNull()
  })
})
