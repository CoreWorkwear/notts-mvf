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
    update: (p) => { calls.push(['update', table, p]); return { eq: () => Promise.resolve({ error: null }) } },
    delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
    insert: (rows) => { calls.push(['insert', table, rows]); return Promise.resolve({ error: null }) },
  })
  return { supabase: { from: qb } }
})

import LeagueTablePanel from './LeagueTablePanel'

const TEAMS = [
  { id: 't-xl', key: 'xl', label: 'First Team', match_name: 'Nottingham', league_name: 'Old League' },
  { id: 't-co', key: 'community', label: 'Community' },
]

beforeEach(() => { calls.length = 0 })

describe('LeagueTablePanel builder', () => {
  test('defaults our row to the match name + offers opponents in the datalist', async () => {
    const { container } = render(<LeagueTablePanel table={[]} teams={TEAMS} seasonId="s1" onSaved={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /build the table/i }))

    // our row pre-fills as "Nottingham" (the competitive name, not "First Team")
    expect(screen.getByPlaceholderText('Team name')).toHaveValue('Nottingham')
    // opponents + our name are pickable from the dropdown
    expect(container.querySelector('datalist#lt-teamnames option[value="Nottingham"]')).toBeTruthy()
    expect(container.querySelector('datalist#lt-teamnames option[value="Boston"]')).toBeTruthy()
    expect(container.querySelector('datalist#lt-teamnames option[value="Lichfield"]')).toBeTruthy()
  })

  test('naming the league writes it to the team (so fixtures pick it up)', async () => {
    render(<LeagueTablePanel table={[]} teams={TEAMS} seasonId="s1" onSaved={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /build the table/i }))

    const league = screen.getByPlaceholderText(/MvF XL National League/i)
    await userEvent.clear(league)
    await userEvent.type(league, 'MvF XL National League')
    await userEvent.click(screen.getByRole('button', { name: /save table/i }))

    await waitFor(() => expect(calls.find((c) => c[0] === 'update' && c[1] === 'teams')).toBeTruthy())
    const upd = calls.find((c) => c[0] === 'update' && c[1] === 'teams')
    expect(upd[2]).toEqual({ league_name: 'MvF XL National League' })
    expect(calls.find((c) => c[0] === 'insert' && c[1] === 'league_tables')).toBeTruthy()
  })
})
