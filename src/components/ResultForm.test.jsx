import { StrictMode, useState } from 'react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Sheet from './Sheet'
import ResultForm from './ResultForm'

// Capture every supabase write so we can assert the result was saved.
const { calls } = vi.hoisted(() => ({ calls: [] }))
vi.mock('../lib/supabase', () => {
  const make = (table) => ({
    upsert: (...a) => { calls.push(['upsert', table, ...a]); return Promise.resolve({ error: null }) },
    insert: (...a) => { calls.push(['insert', table, ...a]); return Promise.resolve({ error: null }) },
    delete: () => ({ eq: (...a) => { calls.push(['delete', table, ...a]); return Promise.resolve({ error: null }) } }),
  })
  return { supabase: { from: (t) => make(t) } }
})

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 60)) })

const FIX = {
  id: 'fix-1',
  opponent: { name: 'Carlton Town' },
  team: { label: 'XL 11s', key: 'xl' },
  result: null,
  goals: [],
}
const SQUAD = [
  { id: 'p1', name: 'Joe Morris', first: 'Joe' },
  { id: 'p2', name: 'Rich King', first: 'Rich' },
]

// Mirrors Fixtures.jsx exactly: a detail sheet open, and "Log the result"
// closes it while opening ResultForm in the same handler.
function Harness({ onSaved }) {
  const [detailOpen, setDetailOpen] = useState(true)
  const [resultFor, setResultFor] = useState(null)
  return (
    <>
      <Sheet open={detailOpen} onClose={() => setDetailOpen(false)}>
        <div>FIXTURE DETAIL</div>
        <button onClick={() => { setDetailOpen(false); setResultFor(FIX) }}>Log the result</button>
      </Sheet>
      <ResultForm
        open={!!resultFor}
        fixture={resultFor}
        squad={SQUAD}
        onClose={() => setResultFor(null)}
        onSaved={onSaved}
      />
    </>
  )
}

beforeEach(() => { calls.length = 0 })

describe('ResultForm — log a result', () => {
  test('opens from the detail→log transition, STAYS open, fills, submits, saves', async () => {
    const onSaved = vi.fn()
    render(<StrictMode><Harness onSaved={onSaved} /></StrictMode>)

    // Open the result sheet the way the app does.
    await userEvent.click(screen.getByText('Log the result'))
    await flush()

    // It must still be open (this is the bug we're guarding).
    expect(screen.getByText('LOG RESULT')).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: /log result/i })
    expect(submit).toBeInTheDocument()

    // Fill the score.
    await userEvent.clear(screen.getByLabelText('Our score'))
    await userEvent.type(screen.getByLabelText('Our score'), '3')
    await userEvent.clear(screen.getByLabelText('Their score'))
    await userEvent.type(screen.getByLabelText('Their score'), '1')

    // Add a goal: scorer from the squad.
    await userEvent.click(screen.getByRole('button', { name: /add goal/i }))
    await userEvent.type(screen.getByPlaceholderText('Scorer'), 'Joe Morris')

    // MOTM.
    await userEvent.type(screen.getByPlaceholderText(/pick or type a name/i), 'Rich King')

    // Submit.
    await userEvent.click(submit)
    await waitFor(() => expect(onSaved).toHaveBeenCalled())

    // The result row was saved with the score we typed…
    const upsert = calls.find((c) => c[0] === 'upsert' && c[1] === 'results')
    expect(upsert).toBeTruthy()
    expect(upsert[2]).toMatchObject({ fixture_id: 'fix-1', us: 3, them: 1 })

    // …and the goal was saved keyed to the squad member's profile_id (not a name).
    const goalInsert = calls.find((c) => c[0] === 'insert' && c[1] === 'goals')
    expect(goalInsert).toBeTruthy()
    expect(goalInsert[2][0]).toMatchObject({ scorer_profile_id: 'p1', scorer_name: null })

    // MOTM resolved to a profile_id too.
    expect(upsert[2]).toMatchObject({ motm_profile_id: 'p2', motm_name: null })
  })

  test('keeps an existing MOTM photo on save', async () => {
    const onSaved = vi.fn()
    const fixture = {
      ...FIX,
      result: { us: 2, them: 0, ht_us: 1, ht_them: 0, motm_profile_id: null, motm_name: 'Guest', motm_photo_url: 'https://cdn/motm.jpg' },
      goals: [],
    }
    render(<ResultForm open fixture={fixture} squad={SQUAD} onClose={() => {}} onSaved={onSaved} />)

    await userEvent.click(screen.getByRole('button', { name: /save result/i }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())

    const upsert = calls.find((c) => c[0] === 'upsert' && c[1] === 'results')
    expect(upsert[2]).toMatchObject({ motm_photo_url: 'https://cdn/motm.jpg' })
  })
})
