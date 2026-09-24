import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// The mock returns whatever's in store.tables for the table queried — it does
// NOT re-implement .eq(), so team_memberships holds only the rows the real
// `.eq('team_id', fixture.team_id)` would have returned.
const store = vi.hoisted(() => ({ tables: {} }))
vi.mock('../lib/supabase', () => {
  const make = (table) => {
    const q = { then: (r) => Promise.resolve({ data: store.tables[table] ?? [], error: null }).then(r) }
    ;['select', 'eq'].forEach((m) => { q[m] = () => q })
    return q
  }
  return { supabase: { from: make } }
})
// Stable identity: WhosInSheet's load effect keys on `user`, and a fresh object
// per render would re-trigger it forever (the real context holds it in state).
const AUTH = vi.hoisted(() => ({ user: { id: 'u1' }, isAdmin: true }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => AUTH }))

import WhosInSheet from './WhosInSheet'

const FIXTURE = {
  id: 'fix-1', team_id: 't-first', match_date: '2026-12-01', kickoff: '13:00:00', venue: 'Pitch 3',
  team: { key: 'xl', label: 'First Team' }, opponent: { name: 'Carlton Town' },
}

const answer = (id, first, last, status) => ({
  status, profile: { id, first_name: first, last_name: last, preferred: null },
})
const member = (id, first, last, over = {}) => ({
  profiles: { id, first_name: first, last_name: last, active: true, approved: true, is_player: true, ...over },
})

beforeEach(() => { store.tables = {} })

describe('WhosInSheet — every bucket is the squad, not whoever answered', () => {
  test('a supporter, a pending signup and a removed player are kept out of in/maybe/out', async () => {
    store.tables = {
      availability: [
        answer('p-in', 'Joe', 'Morris', 'in'),
        answer('p-sup', 'Sue', 'Supporter', 'in'),
        answer('p-pend', 'Pat', 'Pending', 'maybe'),
        answer('p-gone', 'Ollie', 'Old', 'out'),
      ],
      team_memberships: [
        member('p-in', 'Joe', 'Morris'),
        member('p-sup', 'Sue', 'Supporter', { is_player: false }),
        member('p-pend', 'Pat', 'Pending', { approved: false }),
        member('p-gone', 'Ollie', 'Old', { active: false }),
        member('p-quiet', 'Sam', 'Lee'),
      ],
      payments: [],
    }

    render(<WhosInSheet open onClose={() => {}} fixture={FIXTURE} />)

    await waitFor(() => expect(screen.getByText('Joe M')).toBeInTheDocument())
    // The big IN count is squad only.
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText(/Maybe · 0/)).toBeInTheDocument()
    expect(screen.getByText(/Can't make it · 0/)).toBeInTheDocument()
    expect(screen.queryByText('Sue S')).not.toBeInTheDocument()
    expect(screen.queryByText('Pat P')).not.toBeInTheDocument()
    expect(screen.queryByText('Ollie O')).not.toBeInTheDocument()
    // Sam never answered and is still on the roster, so he's the one to chase.
    expect(screen.getByText(/Not replied · 1/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Chase the 1 who've gone quiet/ })).toBeInTheDocument()
  })

  test('a non-squad answer raises no subs line against them', async () => {
    store.tables = {
      availability: [answer('p-in', 'Joe', 'Morris', 'in'), answer('p-sup', 'Sue', 'Supporter', 'in')],
      team_memberships: [member('p-in', 'Joe', 'Morris'), member('p-sup', 'Sue', 'Supporter', { is_player: false })],
      payments: [],
    }

    render(<WhosInSheet open onClose={() => {}} fixture={FIXTURE} />)

    await waitFor(() => expect(screen.getByText(/SUBS · £/)).toBeInTheDocument())
    expect(screen.getByText(/0 of 1 paid/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Not paid' })).toHaveLength(1)
  })
})
