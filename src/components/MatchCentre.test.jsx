import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const store = vi.hoisted(() => ({ lineups: [], availability: [], failed: null }))
vi.mock('../lib/supabase', () => {
  const make = (table) => {
    const q = { then: (r) => Promise.resolve({ data: store[table] ?? [], error: table === store.failed ? Error('offline') : null }).then(r) }
    ;['select', 'eq'].forEach((m) => { q[m] = () => q })
    return q
  }
  return { supabase: { from: make } }
})

vi.mock('./ScoreBug', () => ({ default: () => null }))

import MatchCentre from './MatchCentre'

const FIXTURE = {
  id: 'fix-1', fixture_type: 'League', match_date: '2026-05-01',
  team: { key: 'community', label: 'Community' }, opponent: { name: 'Long Eaton' },
  result: { ht_us: 1, ht_them: 0, us: 2, them: 1, motm_profile_id: null, motm_name: 'Joe Bloggs' },
  goals: [{ id: 'g1', scorer_profile_id: 'p1', scorer_name: 'Joe Bloggs', assist_profile_id: null, assist_name: null, minute: 10 }],
  squadById: {},
}

const answered = (id, first, last, over = {}) => ({
  status: 'in',
  profile: { id, first_name: first, last_name: last, active: true, approved: true, is_player: true, ...over },
})

beforeEach(() => { store.lineups = []; store.availability = []; store.failed = null })

describe('MatchCentre line-up', () => {
  test('opens the award photograph in its own labelled sheet and returns focus to the report', async () => {
    const user = userEvent.setup()
    const fixture = { ...FIXTURE, result: { ...FIXTURE.result, motm_photo_url: '/award.jpg' } }
    render(<MatchCentre open onClose={() => {}} fixture={fixture} />)
    const opener = screen.getByRole('button', { name: "Enlarge Joe Bloggs's photo" })
    await user.click(opener)
    expect(screen.getByRole('dialog', { name: 'Joe Bloggs photo' })).toContainElement(screen.getByRole('img', { name: 'Joe Bloggs' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Joe Bloggs photo' })).toBeNull()
    expect(opener).toHaveFocus()
    expect(screen.getByRole('list', { name: 'Goal timeline' })).toHaveTextContent('10′')
  })

  test.each([[0, 'No goals'], [1, 'No scorers recorded']])('keeps the goals status accurate with %i goals in a loss', async (us, status) => {
    const fixture = { ...FIXTURE, goals: [], result: { ...FIXTURE.result, us, them: 2 } }
    render(<MatchCentre open onClose={() => {}} fixture={fixture} />)
    expect(screen.getByText(status)).toBeVisible()
    await waitFor(() => expect(screen.queryByText(/loading the line-up/i)).toBeNull())
  })

  test.each(['lineups', 'availability'])('when %s fail, keeps the score and retries the squad without claiming a fallback', async table => {
    store.failed = table
    render(<MatchCentre open onClose={() => {}} fixture={FIXTURE} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/line-up/i)
    expect(screen.queryByRole('heading', { name: 'The squad' })).toBeNull()
    expect(screen.getByText(/HT 1–0/)).toBeVisible()
    store.failed = null
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'The squad' })).toBeVisible()
  })
  test('shows the named line-up on a pitch with a goal badge, plus subs', async () => {
    store.lineups = [
      { profile_id: 'p1', role: 'start', slot: 0, position: 'GK', formation: '4-4-2', profiles: { first_name: 'Joe', last_name: 'Bloggs' } },
      { profile_id: 'p2', role: 'sub', slot: null, formation: '4-4-2', profiles: { first_name: 'Sam', last_name: 'Lee' } },
    ]
    render(<MatchCentre open onClose={() => {}} fixture={FIXTURE} isAdmin={false} />)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Line-up' })).toBeInTheDocument())
    expect(screen.getByText('JB')).toBeInTheDocument()   // keeper's initials on the pitch
    expect(screen.getByText('⚽1')).toBeInTheDocument()   // goal badge on the scorer
    expect(screen.getByText('Sam Lee')).toBeInTheDocument() // named sub
  })

  test('falls back to availability when no line-up was named', async () => {
    store.lineups = []
    render(<MatchCentre open onClose={() => {}} fixture={FIXTURE} isAdmin={false} />)
    // No line-up → the old squad heading (scorer shows as a guest in the tally)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'The squad' })).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: 'Line-up' })).not.toBeInTheDocument()
  })

  test('the availability fallback lists squad members only, not supporters, pending signups or removed players', async () => {
    store.lineups = []
    store.availability = [
      answered('p2', 'Sam', 'Lee'),
      answered('p3', 'Sue', 'Supporter', { is_player: false }),
      answered('p4', 'Pat', 'Pending', { approved: false }),
      answered('p5', 'Ollie', 'Old', { active: false }),
    ]
    render(<MatchCentre open onClose={() => {}} fixture={FIXTURE} isAdmin={false} />)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'The squad' })).toBeInTheDocument())
    expect(screen.getByText('Sam Lee')).toBeInTheDocument()
    expect(screen.queryByText('Sue Supporter')).not.toBeInTheDocument()
    expect(screen.queryByText('Pat Pending')).not.toBeInTheDocument()
    expect(screen.queryByText('Ollie Old')).not.toBeInTheDocument()
  })
})

describe('MatchCentre — half time', () => {
  test('shown when recorded', () => {
    render(<MatchCentre open onClose={() => {}} fixture={FIXTURE} isAdmin={false} />)
    expect(screen.getByText(/HT 1–0/)).toBeInTheDocument()
  })
  test('left off when it was not recorded', () => {
    const f = { ...FIXTURE, result: { ...FIXTURE.result, ht_us: null, ht_them: null } }
    render(<MatchCentre open onClose={() => {}} fixture={f} isAdmin={false} />)
    expect(screen.queryByText(/HT/)).toBeNull()
    expect(screen.getByText(/1 May/)).toBeInTheDocument() // the date still shows
  })
})
