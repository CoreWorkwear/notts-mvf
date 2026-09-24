import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Stable identity: the sheet's fetch effect keys on `user`.
const auth = vi.hoisted(() => ({ user: { id: 'u1' }, isAdmin: false }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../lib/logger', () => ({ logError: vi.fn() }))

// A tiny store-driven supabase: rows are filtered by the .eq() keys they carry,
// a table can answer with an error, and a query can be held back (`defer`,
// keyed `table:fixture_id`) so a late response can be simulated.
const { store } = vi.hoisted(() => ({ store: { tables: {}, errors: {}, defer: {} } }))
vi.mock('../lib/supabase', () => {
  const from = (table) => {
    const filters = {}
    const respond = () => {
      if (store.errors[table]) return { data: null, error: store.errors[table] }
      const rows = (store.tables[table] ?? []).filter((r) => Object.entries(filters).every(([k, v]) => !(k in r) || r[k] === v))
      return { data: rows, error: null }
    }
    const q = {
      select: () => q,
      eq: (k, v) => { filters[k] = v; return q },
      upsert: () => Promise.resolve({ error: null }),
      then(onF, onR) {
        const gate = store.defer[`${table}:${filters.fixture_id ?? ''}`] ?? Promise.resolve()
        return gate.then(respond).then(onF, onR)
      },
    }
    return q
  }
  return { supabase: { from, functions: { invoke: vi.fn(async () => ({ data: { sent: 0 }, error: null })) } } }
})

import WhosInSheet from './WhosInSheet'

const fxA = {
  id: 'fA', team_id: 't1', team: { key: 'xl', match_name: 'Nottingham' }, opponent: { name: 'Boston' },
  home_away: 'Home', match_date: '2030-12-01', kickoff: '14:00:00', venue: 'Rec',
}
const fxB = { ...fxA, id: 'fB', opponent: { name: 'Lichfield' } }

const member = (id, first, last, extra = {}) => ({ id, first_name: first, last_name: last, active: true, approved: true, is_player: true, ...extra })
const joe = member('p1', 'Joe', 'Morris')
const sam = member('p2', 'Sam', 'Lee')

beforeEach(() => { store.tables = {}; store.errors = {}; store.defer = {} })

describe("WhosInSheet — a failed load doesn't pose as an empty team-sheet", () => {
  test('failed availability fetch → alert + retry, never "No one\'s in yet"', async () => {
    store.errors.availability = { message: 'boom', code: 'XX000' }
    render(<WhosInSheet open fixture={fxA} onClose={() => {}} />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText(/no one's in yet/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/counting heads/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  test('"Try again" refetches and recovers', async () => {
    store.errors.availability = { message: 'boom', code: 'XX000' }
    store.tables.availability = [{ fixture_id: 'fA', status: 'in', profile: joe }]
    store.tables.team_memberships = [{ team_id: 't1', profiles: joe }]
    render(<WhosInSheet open fixture={fxA} onClose={() => {}} />)
    await screen.findByRole('alert')

    delete store.errors.availability
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('Joe')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('WhosInSheet — only squad members count', () => {
  test("an inactive player's 'in' answer is not on the sheet (agrees with the roster-based Not replied)", async () => {
    store.tables.availability = [
      { fixture_id: 'fA', status: 'in', profile: joe },
      { fixture_id: 'fA', status: 'in', profile: member('p9', 'Gone', 'Bloke', { active: false }) },
      { fixture_id: 'fA', status: 'maybe', profile: member('p8', 'Pending', 'Lad', { approved: false }) },
      { fixture_id: 'fA', status: 'out', profile: member('p7', 'Fan', 'Only', { is_player: false }) },
      // Fully active player, but moved to the OTHER squad — flags alone would
      // let this row through; only roster membership (squadIds) keeps it out.
      { fixture_id: 'fA', status: 'in', profile: member('p6', 'Mo', 'Moved') },
    ]
    store.tables.team_memberships = [
      { team_id: 't1', profiles: joe },
      { team_id: 't1', profiles: sam },
      { team_id: 't2', profiles: member('p6', 'Mo', 'Moved') },
    ]
    const { container } = render(<WhosInSheet open fixture={fxA} onClose={() => {}} />)

    expect(await screen.findByText('Joe')).toBeInTheDocument()
    expect(container.querySelector('.ti-num')).toHaveTextContent('1')
    expect(screen.queryByText(/Gone/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Pending/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Fan/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Mo/)).not.toBeInTheDocument()
    // Sam hasn't replied and IS a squad member → chased.
    expect(screen.getByText('Sam L')).toBeInTheDocument()
  })
})

describe('WhosInSheet — a late answer for a previous fixture is ignored', () => {
  test('open A, then B before A answers: B stays on screen when A lands', async () => {
    store.tables.availability = [
      { fixture_id: 'fA', status: 'in', profile: joe },
      { fixture_id: 'fB', status: 'in', profile: sam },
    ]
    store.tables.team_memberships = [{ team_id: 't1', profiles: joe }, { team_id: 't1', profiles: sam }]
    let releaseA
    store.defer['availability:fA'] = new Promise((r) => { releaseA = r })

    const { rerender } = render(<WhosInSheet open fixture={fxA} onClose={() => {}} />)
    expect(screen.getByText(/counting heads/i)).toBeInTheDocument()

    rerender(<WhosInSheet open fixture={fxB} onClose={() => {}} />)
    expect(await screen.findByText('Sam')).toBeInTheDocument()

    await act(async () => { releaseA(); await new Promise((r) => setTimeout(r, 0)) })
    expect(screen.getByText('Sam')).toBeInTheDocument()
    expect(screen.queryByText('Joe')).not.toBeInTheDocument()
  })
})
