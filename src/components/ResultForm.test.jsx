import { StrictMode, useState } from 'react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Sheet from './Sheet'
import ResultForm from './ResultForm'

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ club: null }) }))

// Capture every supabase write so we can assert the result was saved. `fail`
// lets a test make one op answer with a response-level error (e.g. 'goals.delete').
// `stored` is what a read-back finds: stored.results is the row (or null),
// stored.goals the rows — only the "already has a result" path reads.
const { calls, fail, stored } = vi.hoisted(() => ({ calls: [], fail: {}, stored: {} }))
vi.mock('../lib/supabase', () => {
  const make = (table) => ({
    select: () => {
      const q = {
        eq: () => q, limit: () => q,
        maybeSingle: () => Promise.resolve({ data: stored[table] ?? null, error: fail[`${table}.select`] ?? null }),
        then: (res, rej) => Promise.resolve({ data: stored[table] ?? [], error: fail[`${table}.select`] ?? null }).then(res, rej),
      }
      return q
    },
    upsert: (...a) => { calls.push(['upsert', table, ...a]); return Promise.resolve({ error: fail[`${table}.upsert`] ?? null }) },
    insert: (...a) => { calls.push(['insert', table, ...a]); return stored.pendingInsert ?? Promise.resolve({ error: fail[`${table}.insert`] ?? null }) },
    delete: () => ({ eq: (...a) => { calls.push(['delete', table, ...a]); return Promise.resolve({ error: fail[`${table}.delete`] ?? null }) } }),
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

beforeEach(() => {
  calls.length = 0
  for (const k of Object.keys(fail)) delete fail[k]
  for (const k of Object.keys(stored)) delete stored[k]
})

describe('ResultForm — log a result', () => {
  test('previews the submitted score while the write is pending and returns the draft on failure', async () => {
    const onSaved = vi.fn()
    let settle
    stored.pendingInsert = new Promise(resolve => { settle = resolve })
    render(<ResultForm open fixture={FIX} squad={SQUAD} onClose={vi.fn()} onSaved={onSaved} />)
    await userEvent.type(screen.getByLabelText('1st Team score'), '{selectall}3')
    await userEvent.type(screen.getByLabelText('Carlton Town score'), '{selectall}1')
    await userEvent.click(screen.getByRole('button', { name: 'Log result' }))
    const pending = screen.getByRole('status', { name: 'Saving result' })
    expect(pending).toHaveTextContent('3–1')
    expect(pending).toHaveTextContent('Carlton Town')
    expect(screen.queryByRole('spinbutton')).toBeNull()
    expect(onSaved).not.toHaveBeenCalled()
    await act(async () => settle({ error: new Error('Failed to fetch') }))
    expect(screen.getByRole('alert')).toBeVisible()
    expect(screen.getByLabelText('1st Team score')).toHaveValue(3)
    expect(screen.getByLabelText('Carlton Town score')).toHaveValue(1)
  })

  test('a manager can pick scorer and assist by squad id, including two players with the same name', async () => {
    const squad = [...SQUAD, { id: 'other', name: 'Joe Morris', first: 'Joe' }]
    render(<ResultForm open fixture={FIX} squad={squad} onSaved={vi.fn()} onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /add goal/i }))
    await userEvent.click(screen.getByPlaceholderText('Scorer'))
    await userEvent.click(screen.getAllByRole('button', { name: 'Joe Morris' })[1])
    await userEvent.click(screen.getByPlaceholderText('Assist (optional)'))
    await userEvent.click(screen.getByRole('button', { name: 'Rich King' }))
    await userEvent.click(screen.getByRole('button', { name: /log result/i }))
    await waitFor(() => expect(calls.find(c => c[0] === 'insert' && c[1] === 'goals')?.[2][0])
      .toMatchObject({ scorer_profile_id: 'other', assist_profile_id: 'p2' }))
  })
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
    // Each box is labelled with the team it belongs to, so a test (like a
    // manager) can't mix up which score is which.
    await userEvent.clear(screen.getByLabelText('1st Team score'))
    await userEvent.type(screen.getByLabelText('1st Team score'), '3')
    await userEvent.clear(screen.getByLabelText('Carlton Town score'))
    await userEvent.type(screen.getByLabelText('Carlton Town score'), '1')

    // Add a goal: scorer from the squad.
    await userEvent.click(screen.getByRole('button', { name: /add goal/i }))
    await userEvent.type(screen.getByPlaceholderText('Scorer'), 'Joe Morris')

    // MOTM.
    await userEvent.type(screen.getByPlaceholderText(/pick or type a name/i), 'Rich King')

    // Submit.
    await userEvent.click(submit)
    await waitFor(() => expect(onSaved).toHaveBeenCalled())

    // The result row was saved with the score we typed… (a NEW result is an
    // insert, never an upsert — see "never overwrites one that already exists").
    const upsert = calls.find((c) => c[0] === 'insert' && c[1] === 'results')
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

// `squad` is ACTIVE players only, so a goal or MOTM credited to a player who has
// since left the club (soft-deleted) must survive an edit — not be blanked and
// silently dropped by the delete-then-insert.
describe('ResultForm — editing keeps credits for players who have left', () => {
  const RESULT = { us: 1, them: 0, ht_us: 0, ht_them: 0, motm_photo_url: null }
  const playedByLeaver = {
    ...FIX,
    result: { ...RESULT, motm_profile_id: 'p-old', motm_name: null },
    goals: [{ scorer_profile_id: 'p-old', scorer_name: null, assist_profile_id: null, assist_name: null, minute: 12 }],
  }

  test('an id not in the active squad is carried through the save untouched', async () => {
    const onSaved = vi.fn()
    render(<ResultForm open fixture={playedByLeaver} squad={SQUAD} onClose={() => {}} onSaved={onSaved} />)

    // Shown honestly rather than blanked.
    expect(screen.getByPlaceholderText('Scorer')).toHaveValue('Former player')
    expect(screen.getByPlaceholderText(/pick or type a name/i)).toHaveValue('Former player')

    await userEvent.click(screen.getByRole('button', { name: /save result/i }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())

    const upsert = calls.find((c) => c[0] === 'upsert' && c[1] === 'results')
    expect(upsert[2]).toMatchObject({ motm_profile_id: 'p-old', motm_name: null })
    const goalInsert = calls.find((c) => c[0] === 'insert' && c[1] === 'goals')
    expect(goalInsert).toBeTruthy()
    expect(goalInsert[2]).toHaveLength(1)
    expect(goalInsert[2][0]).toMatchObject({ scorer_profile_id: 'p-old', scorer_name: null, minute: 12 })
  })

  test('with `everyone`, a former player resolves to their name and still saves by id', async () => {
    const onSaved = vi.fn()
    const everyone = [...SQUAD, { id: 'p-old', name: 'Old Boy', first: 'Old' }]
    render(
      <ResultForm open fixture={playedByLeaver} squad={SQUAD} everyone={everyone} onClose={() => {}} onSaved={onSaved} />,
    )
    expect(screen.getByPlaceholderText('Scorer')).toHaveValue('Old Boy')
    expect(screen.getByPlaceholderText(/pick or type a name/i)).toHaveValue('Old Boy')
    // …but the pickers still only offer the active squad.
    await userEvent.click(screen.getByPlaceholderText('Assist (optional)'))
    expect(screen.queryByRole('button', { name: 'Old Boy' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Joe Morris' })).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: /save result/i }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(calls.find((c) => c[0] === 'upsert' && c[1] === 'results')[2]).toMatchObject({ motm_profile_id: 'p-old', motm_name: null })
    expect(calls.find((c) => c[0] === 'insert' && c[1] === 'goals')[2][0]).toMatchObject({ scorer_profile_id: 'p-old', scorer_name: null })
  })

  test('retyping the scorer drops the carried id and resolves the new name', async () => {
    const onSaved = vi.fn()
    render(<ResultForm open fixture={playedByLeaver} squad={SQUAD} onClose={() => {}} onSaved={onSaved} />)
    const scorer = screen.getByPlaceholderText('Scorer')
    await userEvent.clear(scorer)
    await userEvent.type(scorer, 'Joe Morris')
    await userEvent.click(screen.getByRole('button', { name: /save result/i }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(calls.find((c) => c[0] === 'insert' && c[1] === 'goals')[2][0]).toMatchObject({ scorer_profile_id: 'p1', scorer_name: null })
  })
})

describe('ResultForm — a failed goals delete stops the save', () => {
  test('no goals are re-inserted (they would double up) and the manager is told', async () => {
    fail['goals.delete'] = { message: 'boom', code: 'XX000' }
    const onSaved = vi.fn()
    const played = {
      ...FIX,
      result: { us: 1, them: 0, ht_us: 0, ht_them: 0, motm_profile_id: null, motm_name: null, motm_photo_url: null },
      goals: [{ scorer_profile_id: 'p1', scorer_name: null, assist_profile_id: null, assist_name: null, minute: 40 }],
    }
    render(<ResultForm open fixture={played} squad={SQUAD} onClose={() => {}} onSaved={onSaved} />)
    await userEvent.click(screen.getByRole('button', { name: /save result/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(calls.find((c) => c[0] === 'delete' && c[1] === 'goals')).toBeTruthy()
    expect(calls.find((c) => c[0] === 'insert' && c[1] === 'goals')).toBeFalsy()
    expect(onSaved).not.toHaveBeenCalled()
  })
})

// Scorers are what the club's stats are built from — they key by profile_id and
// feed the golden boot. Nothing used to tie them to the score typed directly
// above, so "3–1" with one scorer named saved happily and left the top-scorer
// table quietly wrong for the rest of the season, with nothing on screen to say
// so. This is a visible nudge, deliberately NOT a gate: an own goal, or a name
// nobody can remember, must still be savable.
describe('ResultForm — scorers are reconciled against the score', () => {
  const openForm = async () => {
    render(<StrictMode><Harness onSaved={vi.fn()} /></StrictMode>)
    await userEvent.click(screen.getByText('Log the result'))
    await flush()
  }
  const setOurScore = async (n) => {
    await userEvent.clear(screen.getByLabelText('1st Team score'))
    await userEvent.type(screen.getByLabelText('1st Team score'), n)
  }

  test('says how many goals still need a scorer', async () => {
    await openForm()
    await setOurScore('3')
    expect(screen.getByRole('status')).toHaveTextContent(/scorers missing · 3 of 3/i)

    await userEvent.click(screen.getByRole('button', { name: /add goal/i }))
    await userEvent.type(screen.getByPlaceholderText('Scorer'), 'Joe Morris')
    expect(screen.getByRole('status')).toHaveTextContent(/scorers missing · 2 of 3/i)
  })

  test('an opened but empty scorer row does not count as accounted for', async () => {
    await openForm()
    await setOurScore('1')
    // A row exists, but the manager hasn't typed a name into it yet.
    await userEvent.click(screen.getByRole('button', { name: /add goal/i }))
    expect(screen.getByRole('status')).toHaveTextContent(/scorers missing · 1 of 1/i)
  })

  test('the nudge clears once every goal has a scorer', async () => {
    await openForm()
    await setOurScore('1')
    await userEvent.click(screen.getByRole('button', { name: /add goal/i }))
    await userEvent.type(screen.getByPlaceholderText('Scorer'), 'Rich King')
    expect(screen.queryByRole('status')).toBeNull()
  })

  test('naming more scorers than the score allows is flagged the other way', async () => {
    await openForm()
    await setOurScore('1')
    await userEvent.click(screen.getByRole('button', { name: /add goal/i }))
    await userEvent.click(screen.getByRole('button', { name: /add goal/i }))
    const scorers = screen.getAllByPlaceholderText('Scorer')
    await userEvent.type(scorers[0], 'Joe Morris')
    await userEvent.type(scorers[1], 'Rich King')
    expect(screen.getByRole('status')).toHaveTextContent(/scorers named · 2 for 1 goal/i)
  })

  test('the nudge never blocks the save — a nil-nil or an own goal still logs', async () => {
    const onSaved = vi.fn()
    render(<StrictMode><Harness onSaved={onSaved} /></StrictMode>)
    await userEvent.click(screen.getByText('Log the result'))
    await flush()
    await userEvent.clear(screen.getByLabelText('1st Team score'))
    await userEvent.type(screen.getByLabelText('1st Team score'), '2')
    // Deliberately name nobody — the nudge is showing.
    expect(screen.getByRole('status')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /log result/i }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(calls.find((c) => c[0] === 'insert' && c[1] === 'results')[2]).toMatchObject({ us: 2 })
  })
})

// A fixture row with no `result` on it is not proof that none is stored: the
// Fixtures calendar hands over played games without one, and a second manager
// can be looking at a stale needs-a-result list. An upsert from there overwrote
// the stored score, half-time and MOTM and then deleted every goal. A new
// result is therefore an INSERT, so the database refuses it when one exists.
describe('ResultForm — a new result never overwrites one that already exists', () => {
  // A blank form's results row: what the form sends when nothing is typed.
  const BLANK_ROW = { us: 0, them: 0, ht_us: 0, ht_them: 0, motm_profile_id: null, motm_name: null, motm_photo_url: null }
  const DUPLICATE = { code: '23505', message: 'duplicate key value violates unique constraint "results_pkey"' }

  async function openBlank(onSaved = () => {}, onStale = () => {}) {
    render(<StrictMode><ResultForm open fixture={FIX} squad={SQUAD} onClose={() => {}} onSaved={onSaved} onStale={onStale} /></StrictMode>)
    await flush()
  }

  test('logging a new result inserts — it does not upsert over whatever is there', async () => {
    const onSaved = vi.fn()
    await openBlank(onSaved)
    await userEvent.click(screen.getByRole('button', { name: /log result/i }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(calls.find((c) => c[0] === 'insert' && c[1] === 'results')).toBeTruthy()
    expect(calls.find((c) => c[0] === 'upsert' && c[1] === 'results')).toBeFalsy()
  })

  test('when a result is already stored the save is refused: nothing is deleted, the manager is sent to Results, and the list behind is refreshed', async () => {
    fail['results.insert'] = DUPLICATE
    stored.results = { ...BLANK_ROW, us: 4, them: 2 } // somebody else's result
    stored.goals = [{ id: 'g1' }]
    const onSaved = vi.fn(), onStale = vi.fn()
    await openBlank(onSaved, onStale)
    await userEvent.click(screen.getByRole('button', { name: /log result/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/result already logged/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/results/i)
    expect(calls.find((c) => c[0] === 'delete' && c[1] === 'goals')).toBeFalsy()
    expect(calls.find((c) => c[0] === 'insert' && c[1] === 'goals')).toBeFalsy()
    expect(onSaved).not.toHaveBeenCalled()
    // Without this the game stays under "needs a result" on the page behind and
    // "open it from Results" cannot be followed.
    expect(onStale).toHaveBeenCalled()
  })

  // Pitch-side signal: the first tap's insert LANDED but its response was lost,
  // so the manager is told to try again. The retry meets its own row. Refusing
  // it there saved the score with no scorers and threw away the typed list.
  test('a lost response then a duplicate: our own row is recognised and the scorers are saved', async () => {
    const onSaved = vi.fn()
    await openBlank(onSaved)
    await userEvent.click(screen.getByRole('button', { name: /add goal/i }))
    await userEvent.type(screen.getByPlaceholderText('Scorer'), 'Joe Morris')

    fail['results.insert'] = { message: 'TypeError: Failed to fetch' }
    await userEvent.click(screen.getByRole('button', { name: /log result/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()

    fail['results.insert'] = DUPLICATE
    stored.results = { ...BLANK_ROW } // exactly what we sent
    stored.goals = []                 // and no scorers yet
    await userEvent.click(screen.getByRole('button', { name: /log result/i }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(calls.find((c) => c[0] === 'insert' && c[1] === 'goals')[2][0]).toMatchObject({ scorer_profile_id: 'p1' })
  })

  test('the same stored score but with scorers already on it is NOT ours to replace', async () => {
    fail['results.insert'] = DUPLICATE
    stored.results = { ...BLANK_ROW }
    stored.goals = [{ id: 'g1' }]
    const onSaved = vi.fn()
    await openBlank(onSaved)
    await userEvent.click(screen.getByRole('button', { name: /log result/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/result already logged/i)
    expect(calls.find((c) => c[0] === 'delete' && c[1] === 'goals')).toBeFalsy()
    expect(onSaved).not.toHaveBeenCalled()
  })

  test('if the read-back itself fails nothing is assumed: no delete, and the next tap checks again', async () => {
    fail['results.insert'] = DUPLICATE
    fail['results.select'] = { message: 'TypeError: Failed to fetch' }
    const onSaved = vi.fn()
    await openBlank(onSaved)
    await userEvent.click(screen.getByRole('button', { name: /log result/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(calls.find((c) => c[0] === 'delete' && c[1] === 'goals')).toBeFalsy()
    expect(onSaved).not.toHaveBeenCalled()
  })

  test("a retry after the goals step failed is not mistaken for someone else's result", async () => {
    fail['goals.delete'] = { message: 'boom', code: 'XX000' }
    const onSaved = vi.fn(), onStale = vi.fn()
    await openBlank(onSaved, onStale)
    await userEvent.click(screen.getByRole('button', { name: /log result/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
    // The score did go in, so the page behind must stop listing the game as unlogged.
    expect(onStale).toHaveBeenCalled()

    // Our own results row landed on the first go. From here a second insert
    // would be refused as a duplicate — the retry has to be allowed to finish.
    delete fail['goals.delete']
    fail['results.insert'] = { code: '23505', message: 'duplicate key' }
    await userEvent.click(screen.getByRole('button', { name: /log result/i }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(calls.filter((c) => c[0] === 'insert' && c[1] === 'results')).toHaveLength(1)
    expect(calls.find((c) => c[0] === 'upsert' && c[1] === 'results')).toBeTruthy()
  })

  test('editing a result that was loaded with the fixture still replaces it', async () => {
    const onSaved = vi.fn()
    const played = {
      ...FIX,
      result: { us: 1, them: 0, ht_us: 0, ht_them: 0, motm_profile_id: null, motm_name: null, motm_photo_url: null },
      goals: [],
    }
    render(<ResultForm open fixture={played} squad={SQUAD} onClose={() => {}} onSaved={onSaved} />)
    await userEvent.click(screen.getByRole('button', { name: /save result/i }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(calls.find((c) => c[0] === 'upsert' && c[1] === 'results')).toBeTruthy()
    expect(calls.find((c) => c[0] === 'insert' && c[1] === 'results')).toBeFalsy()
  })
})

// "Half time · optional" was prefilled 0–0 and always written, so every result
// logged without it told the squad "HT 0–0". The columns were NOT NULL DEFAULT
// 0 (migration 0039 makes them nullable). The form now leaves them out when
// blank, which is right both before that migration runs and after.
describe('ResultForm — half time is optional', () => {
  const open = (fixture = FIX) => render(<ResultForm open fixture={fixture} squad={SQUAD} onClose={() => {}} onSaved={() => {}} />)
  const ht = () => screen.getAllByRole('spinbutton', { name: /half-time score/i })
  const saved = () => calls.find((c) => (c[0] === 'insert' || c[0] === 'upsert') && c[1] === 'results')[2]

  test('a new result opens with half time blank, not 0–0', () => {
    open()
    expect(ht().map((i) => i.value)).toEqual(['', ''])
  })

  test('left blank, half time is not written at all', async () => {
    open()
    await userEvent.type(screen.getByRole('spinbutton', { name: '1st Team score' }), '{selectall}2')
    await userEvent.click(screen.getByRole('button', { name: /log result/i }))
    await flush()
    expect(saved()).not.toHaveProperty('ht_us')
    expect(saved()).not.toHaveProperty('ht_them')
    expect(saved()).toMatchObject({ us: 2, them: 0 })
  })

  test('filled in, it is saved; one side left blank counts as nil', async () => {
    open()
    await userEvent.type(screen.getByRole('spinbutton', { name: '1st Team score' }), '{selectall}3')
    await userEvent.type(ht()[0], '1')
    await userEvent.click(screen.getByRole('button', { name: /log result/i }))
    await flush()
    expect(saved()).toMatchObject({ us: 3, them: 0, ht_us: 1, ht_them: 0 })
  })

  test('a half-time score higher than full time is refused before anything is written', async () => {
    open()
    await userEvent.type(screen.getByRole('spinbutton', { name: '1st Team score' }), '{selectall}1')
    await userEvent.type(ht()[0], '2')
    await userEvent.click(screen.getByRole('button', { name: /log result/i }))
    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent(/half time/i)
    expect(calls).toHaveLength(0)
  })

  test('editing a result that has no half time keeps it that way', async () => {
    open({ ...FIX, result: { us: 2, them: 1, ht_us: null, ht_them: null, motm_profile_id: null, motm_name: null } })
    expect(ht().map((i) => i.value)).toEqual(['', ''])
    await userEvent.click(screen.getByRole('button', { name: /save|log result/i }))
    await flush()
    expect(saved()).not.toHaveProperty('ht_us')
  })

  test('editing one that has a half time shows it, and clearing it clears it', async () => {
    open({ ...FIX, result: { us: 2, them: 1, ht_us: 1, ht_them: 1, motm_profile_id: null, motm_name: null } })
    expect(ht().map((i) => i.value)).toEqual(['1', '1'])
    await userEvent.clear(ht()[0]); await userEvent.clear(ht()[1])
    await userEvent.click(screen.getByRole('button', { name: /save|log result/i }))
    await flush()
    expect(saved()).toMatchObject({ ht_us: null, ht_them: null })
  })
})
