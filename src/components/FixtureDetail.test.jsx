import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// WeatherStrip does a network fetch — stub it out for a quiet unit test.
vi.mock('./WeatherStrip', () => ({ default: () => null }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../lib/logger', () => ({ logError: vi.fn() }))
const { pin } = vi.hoisted(() => ({ pin: vi.fn() }))
vi.mock('../hooks/useFixtures', () => ({ setPinnedImage: pin }))

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
      then(onF, onR) {
        const gate = store.defer[`${table}:${filters.fixture_id ?? ''}`] ?? Promise.resolve()
        return gate.then(respond).then(onF, onR)
      },
    }
    return q
  }
  return { supabase: { from } }
})

import FixtureDetail from './FixtureDetail'

const fx = {
  id: 'f1', myStatus: 'out', team_id: 't-first',
  team: { key: 'xl', label: 'First Team', match_name: 'Nottingham' },
  opponent: { name: 'Boston' }, home_away: 'Home', fixture_type: 'League',
  match_date: '2030-12-01', kickoff: '14:00:00', venue: 'X',
}

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

beforeEach(() => {
  store.tables = {}; store.errors = {}; store.defer = {}
  pin.mockReset(); pin.mockResolvedValue({ error: null })
})

describe('FixtureDetail — §2.2 availability reflects immediately', () => {
  test('picking In updates the displayed selection without reopening the sheet', async () => {
    const onSetAvail = vi.fn().mockResolvedValue()
    render(<FixtureDetail open fixture={fx} isAdmin={false} onSetAvail={onSetAvail} onClose={() => {}} />)

    const inBtn = screen.getByRole('button', { name: "I'm in" })
    expect(inBtn).toHaveAttribute('aria-pressed', 'false') // starts on "out"

    await userEvent.click(inBtn)
    expect(onSetAvail).toHaveBeenCalledWith('in')
    // The DISPLAYED state must move to In immediately (the bug: it stayed on the
    // stale snapshot until the sheet was reopened).
    await waitFor(() => expect(inBtn).toHaveAttribute('aria-pressed', 'true'))
  })

  // §2.3 regression — all three availability options must be present + selectable
  // on the drill-down (they'd gone missing here before).
  test('shows all three availability options', async () => {
    render(<FixtureDetail open fixture={fx} isAdmin={false} onSetAvail={vi.fn()} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: "I'm in" })).toBeVisible()
    expect(screen.getByRole('button', { name: /^maybe$/i })).toBeVisible()
    expect(screen.getByRole('button', { name: /can't make it/i })).toBeVisible()
    await tick() // let the who's-in fetch settle inside the test
  })

  // Fixtures.handleSetAvail resolves false (not a throw) when the write failed
  // after retrying — that must not be announced as "Saved ✓".
  test('a failed write is rolled back and NOT announced as saved', async () => {
    const onSetAvail = vi.fn().mockResolvedValue(false)
    render(<FixtureDetail open fixture={fx} isAdmin={false} onSetAvail={onSetAvail} onClose={() => {}} />)
    const inBtn = screen.getByRole('button', { name: "I'm in" })
    await userEvent.click(inBtn)
    await waitFor(() => expect(onSetAvail).toHaveBeenCalledWith('in'))
    await tick()
    expect(screen.queryByText('Saved ✓')).not.toBeInTheDocument()
    expect(inBtn).toHaveAttribute('aria-pressed', 'false') // back on "out"
  })
})

// This sheet is also how the Calendar opens a game, so it is the one surface
// that can be pointed at a fixture already played — and at a fixture belonging
// to a squad the viewer isn't in (0034).
describe('FixtureDetail — team-scoped availability', () => {
  test('a player outside the squad gets no options on the Availability tab', async () => {
    render(<FixtureDetail open fixture={fx} isAdmin={false} blockReason="other-team" onSetAvail={vi.fn()} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: "I'm in" })).not.toBeInTheDocument()
    expect(screen.getByText(/First Team squad only/i)).toBeInTheDocument()
    await tick()
  })

  test('a game that has kicked off is closed, whichever way it was opened', async () => {
    render(<FixtureDetail open fixture={fx} isAdmin={false} blockReason="kicked-off" onSetAvail={vi.fn()} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: "I'm in" })).not.toBeInTheDocument()
    expect(screen.getByText(/shut at kickoff/i)).toBeInTheDocument()
    await tick()
  })
})

describe("FixtureDetail — Who's in tab", () => {
  const joe = { id: 'p1', first_name: 'Joe', last_name: 'Morris' }
  const sam = { id: 'p2', first_name: 'Sam', last_name: 'Lee' }
  // Both in the t-first squad — the tab only lists roster members' answers.
  const roster = (ids) => ids.map((id) => ({ team_id: 't-first', profiles: { id, active: true, approved: true, is_player: true } }))

  test('a failed fetch says so — not "Available · 0"', async () => {
    store.errors.availability = { message: 'boom', code: 'XX000' }
    render(<FixtureDetail open fixture={fx} isAdmin={false} onSetAvail={vi.fn()} onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /who's in/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText(/available · 0/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  // The one-squad-definition rule (squadIds): answers from a supporter, a
  // pending signup, a deactivated player, or someone since moved to the other
  // squad are left off — this tab must agree with the hero counts.
  test("lists this squad's answers only", async () => {
    store.tables.availability = [
      { fixture_id: 'f1', status: 'in', profile: joe },
      { fixture_id: 'f1', status: 'in', profile: { id: 'p-sup', first_name: 'Sue', last_name: 'Supporter' } },
      { fixture_id: 'f1', status: 'maybe', profile: { id: 'p-pend', first_name: 'Pat', last_name: 'Pending' } },
      { fixture_id: 'f1', status: 'out', profile: { id: 'p-moved', first_name: 'Mo', last_name: 'Moved' } },
    ]
    store.tables.team_memberships = [
      ...roster(['p1']),
      { team_id: 't-first', profiles: { id: 'p-sup', active: true, approved: true, is_player: false } },
      { team_id: 't-first', profiles: { id: 'p-pend', active: true, approved: false, is_player: true } },
      { team_id: 't-other', profiles: { id: 'p-moved', active: true, approved: true, is_player: true } },
    ]
    render(<FixtureDetail open fixture={fx} isAdmin={false} onSetAvail={vi.fn()} onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /who's in/i }))

    expect(await screen.findByText('Joe M')).toBeInTheDocument()
    expect(screen.getByText(/Available · 1/)).toBeInTheDocument()
    expect(screen.queryByText('Sue S')).not.toBeInTheDocument()
    expect(screen.queryByText('Pat P')).not.toBeInTheDocument()
    expect(screen.queryByText('Mo M')).not.toBeInTheDocument()
  })

  test("switching fixture never shows the previous game's names", async () => {
    store.tables.availability = [
      { fixture_id: 'f1', status: 'in', profile: joe },
      { fixture_id: 'f2', status: 'in', profile: sam },
    ]
    store.tables.team_memberships = roster(['p1', 'p2'])
    let releaseB
    store.defer['availability:f2'] = new Promise((r) => { releaseB = r })

    const { rerender } = render(<FixtureDetail open fixture={fx} isAdmin={false} onSetAvail={vi.fn()} onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /who's in/i }))
    expect(await screen.findByText('Joe M')).toBeInTheDocument()

    // Open game B while its answer is still on the wire.
    rerender(<FixtureDetail open fixture={{ ...fx, id: 'f2' }} isAdmin={false} onSetAvail={vi.fn()} onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /who's in/i }))
    expect(screen.queryByText('Joe M')).not.toBeInTheDocument()

    await act(async () => { releaseB(); await new Promise((r) => setTimeout(r, 0)) })
    expect(await screen.findByText('Sam L')).toBeInTheDocument()
    expect(screen.queryByText('Joe M')).not.toBeInTheDocument()
  })

  test("a late answer for the previous fixture doesn't overwrite the current one", async () => {
    store.tables.availability = [
      { fixture_id: 'f1', status: 'in', profile: joe },
      { fixture_id: 'f2', status: 'in', profile: sam },
    ]
    store.tables.team_memberships = roster(['p1', 'p2'])
    let releaseA
    store.defer['availability:f1'] = new Promise((r) => { releaseA = r })

    const { rerender } = render(<FixtureDetail open fixture={fx} isAdmin={false} onSetAvail={vi.fn()} onClose={() => {}} />)
    rerender(<FixtureDetail open fixture={{ ...fx, id: 'f2' }} isAdmin={false} onSetAvail={vi.fn()} onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /who's in/i }))
    expect(await screen.findByText('Sam L')).toBeInTheDocument()

    await act(async () => { releaseA(); await new Promise((r) => setTimeout(r, 0)) })
    expect(screen.getByText('Sam L')).toBeInTheDocument()
    expect(screen.queryByText('Joe M')).not.toBeInTheDocument()
  })
})

describe('FixtureDetail — pinning a poster photo', () => {
  test('a failed pin is surfaced, and the list is not refreshed as if it worked', async () => {
    store.tables.media_assets = [{ id: 'm1', url: 'https://cdn/a.jpg' }]
    pin.mockResolvedValue({ error: { message: 'nope', code: '42501' } })
    const onChanged = vi.fn()
    render(<FixtureDetail open fixture={fx} isAdmin onSetAvail={vi.fn()} onChanged={onChanged} onClose={() => {}} />)

    await userEvent.click(await screen.findByRole('button', { name: /pin this photo/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(pin).toHaveBeenCalledWith('f1', 'm1')
    expect(onChanged).not.toHaveBeenCalled()
  })

  test('a successful pin refreshes the list', async () => {
    store.tables.media_assets = [{ id: 'm1', url: 'https://cdn/a.jpg' }]
    const onChanged = vi.fn()
    render(<FixtureDetail open fixture={fx} isAdmin onSetAvail={vi.fn()} onChanged={onChanged} onClose={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: /pin this photo/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
