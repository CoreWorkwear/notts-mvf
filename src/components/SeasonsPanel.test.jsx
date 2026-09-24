import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ profile: { club_id: 'c1' } }) }))
const season = vi.hoisted(() => ({ ctx: null }))
vi.mock('../context/SeasonContext', () => ({ useSeason: () => season.ctx }))

// Records every write; `failClear` makes the "clear the other seasons" update
// (is_current:false) answer with an error while everything else succeeds.
const { store } = vi.hoisted(() => ({ store: { writes: [], failClear: false } }))
vi.mock('../lib/supabase', () => {
  const from = (table) => {
    let op = null, payload = null
    const respond = () => {
      const isClear = op === 'update' && payload?.is_current === false
      return { data: null, error: isClear && store.failClear ? { message: 'boom', code: 'XX000' } : null }
    }
    const q = {
      update: (p) => { op = 'update'; payload = p; store.writes.push({ table, op, payload: p }); return q },
      insert: (p) => { op = 'insert'; payload = p; store.writes.push({ table, op, payload: p }); return q },
      eq: () => q, neq: () => q, select: () => q,
      single: () => Promise.resolve({ data: { id: 'new' }, error: null }),
      then(onF, onR) { return Promise.resolve(respond()).then(onF, onR) },
    }
    return q
  }
  return { supabase: { from } }
})

import SeasonsPanel from './SeasonsPanel'

beforeEach(() => {
  store.writes.length = 0; store.failClear = false
  season.ctx = {
    seasons: [
      { id: 's1', label: '2025/26', is_current: true, start_date: '2025-08-01', end_date: null },
      { id: 's2', label: '2026/27', is_current: false, start_date: null, end_date: null },
    ],
    seasonId: 's1', setSeasonId: vi.fn(), refreshSeasons: vi.fn(async () => {}),
  }
})

describe('SeasonsPanel — Set current', () => {
  test('clears the others first, then sets the new one', async () => {
    render(<SeasonsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /set current/i }))
    await waitFor(() => expect(season.ctx.setSeasonId).toHaveBeenCalledWith('s2'))
    const updates = store.writes.filter((w) => w.op === 'update').map((w) => w.payload)
    expect(updates).toEqual([{ is_current: false }, { is_current: true }])
    expect(season.ctx.refreshSeasons).toHaveBeenCalled()
  })

  // If clearing the old current season fails and we press on, two seasons end
  // up current. The failure must stop the second write and be shown.
  test('if clearing the old current fails, the new one is NOT set and the manager is told', async () => {
    store.failClear = true
    render(<SeasonsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /set current/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(store.writes.filter((w) => w.op === 'update')).toHaveLength(1)
    expect(store.writes[0].payload).toEqual({ is_current: false })
    expect(season.ctx.setSeasonId).not.toHaveBeenCalled()
    expect(season.ctx.refreshSeasons).not.toHaveBeenCalled()
  })
})
