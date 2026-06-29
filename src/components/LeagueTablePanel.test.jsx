import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const calls = vi.hoisted(() => [])
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ isAdmin: true, profile: { club_id: 'c1' } }) }))
vi.mock('../hooks/useOpponents', () => ({
  useOpponents: () => ({ opponents: [{ id: 'o1', name: 'Boston' }, { id: 'o2', name: 'Lichfield' }] }),
}))
vi.mock('../lib/supabase', () => {
  const qb = (table) => ({
    delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
    insert: (rows) => { calls.push(['insert', table, rows]); return Promise.resolve({ error: null }) },
  })
  return { supabase: { from: qb } }
})

import LeagueTablePanel from './LeagueTablePanel'

const TEAMS = [
  { id: 't-xl', key: 'xl', label: 'First Team', match_name: 'Nottingham' },
  { id: 't-co', key: 'community', label: 'Community' },
]
const COMPETITIONS = [{ id: 'comp-1', name: 'Sunday League', type: 'league' }]

beforeEach(() => { calls.length = 0 })

describe('LeagueTablePanel (per competition)', () => {
  test('with no competitions, prompts to add one', () => {
    render(<LeagueTablePanel table={[]} competitions={[]} teams={TEAMS} seasonId="s1" onSaved={vi.fn()} />)
    expect(screen.getByText(/no competitions yet/i)).toBeInTheDocument()
  })

  test('builds a table keyed to the competition; offers our names + opponents in the datalist', async () => {
    const { container } = render(<LeagueTablePanel table={[]} competitions={COMPETITIONS} teams={TEAMS} seasonId="s1" onSaved={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /build the table/i }))

    // pickable names: our competitive name + opponents (no longer a league-name field)
    expect(container.querySelector('datalist#lt-teamnames option[value="Nottingham"]')).toBeTruthy()
    expect(container.querySelector('datalist#lt-teamnames option[value="Boston"]')).toBeTruthy()
    expect(screen.queryByText(/league name/i)).not.toBeInTheDocument()

    await userEvent.type(screen.getByPlaceholderText('Team name'), 'Nottingham')
    await userEvent.click(screen.getByRole('button', { name: /save table/i }))

    await waitFor(() => expect(calls.find((c) => c[0] === 'insert' && c[1] === 'league_tables')).toBeTruthy())
    const ins = calls.find((c) => c[0] === 'insert' && c[1] === 'league_tables')
    expect(ins[2][0]).toMatchObject({ competition_id: 'comp-1', season_id: 's1', team_name: 'Nottingham' })
    // never touches teams.league_name any more
    expect(calls.find((c) => c[1] === 'teams')).toBeFalsy()
  })

  test('retired competitions are hidden; the first active league is the default', () => {
    const comps = [
      { id: 'first', name: 'MvF Midlands League', type: 'league', active: true, sort_order: 1 },
      { id: 'comm', name: 'MvF Community League', type: 'league', active: true, sort_order: 2 },
      { id: 'old', name: 'MvF XL National League', type: 'league', active: false, sort_order: 9 },
    ]
    const table = [
      { id: 'r1', competition_id: 'first', team_name: 'Nottingham', played: 1, won: 1, drawn: 0, lost: 0, gf: 2, ga: 0, pts: 3 },
    ]
    render(<LeagueTablePanel table={table} competitions={comps} teams={TEAMS} seasonId="s1" onSaved={vi.fn()} />)
    // retired one is not offered as a chip…
    expect(screen.queryByRole('button', { name: 'MvF XL National League' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'MvF Midlands League' })).toBeInTheDocument()
    // …and the default selection is the first active league (its row renders)
    expect(screen.getByText('Nottingham')).toBeInTheDocument()
  })

  test('highlights our row (by match name) in the standings', () => {
    const table = [
      { id: 'r1', competition_id: 'comp-1', team_name: 'Nottingham', played: 1, won: 1, drawn: 0, lost: 0, gf: 2, ga: 0, pts: 3 },
      { id: 'r2', competition_id: 'comp-1', team_name: 'Boston', played: 1, won: 0, drawn: 0, lost: 1, gf: 0, ga: 2, pts: 0 },
    ]
    const { container } = render(<LeagueTablePanel table={table} competitions={COMPETITIONS} teams={TEAMS} seasonId="s1" onSaved={vi.fn()} />)
    const ours = [...container.querySelectorAll('tr.lt-ours .lt-team')].map((td) => td.textContent)
    expect(ours).toEqual(['Nottingham'])
  })
})
