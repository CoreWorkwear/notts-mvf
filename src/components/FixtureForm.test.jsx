import { StrictMode, useState } from 'react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Sheet from './Sheet'
import FixtureForm from './FixtureForm'
import { FIXTURE_COLUMNS } from '../hooks/useFixtures'

const { calls } = vi.hoisted(() => ({ calls: [] }))
vi.mock('../lib/supabase', () => {
  const make = (table) => ({
    insert: (...a) => {
      calls.push(['insert', table, ...a])
      const p = Promise.resolve({ data: { id: 'new-opp' }, error: null })
      p.select = () => ({ single: () => Promise.resolve({ data: { id: 'new-opp' }, error: null }) })
      return p
    },
    update: (...a) => { calls.push(['update', table, ...a]); return { eq: () => Promise.resolve({ error: null }) } },
    delete: () => ({ eq: (...a) => { calls.push(['delete', table, ...a]); return Promise.resolve({ error: null }) } }),
  })
  return { supabase: { from: (t) => make(t) } }
})
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ profile: { club_id: 'club-1' } }) }))
vi.mock('../lib/geocode', () => ({
  normalizePostcode: (s) => (s || '').toUpperCase().trim(),
  geocodePostcode: vi.fn(async () => ({ lat: 52.95, lng: -1.15 })),
}))

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 60)) })

const TEAMS = [
  { id: 't-xl', key: 'xl', label: 'XL 11s', colour: '#E11D2A', is_first_team: true, league_name: 'MvF XL National League' },
  { id: 't-co', key: 'community', label: 'Community', colour: '#2FA84F', is_first_team: false, league_name: 'MvF Community League' },
]
const OPPONENTS = [
  { id: 'opp-1', name: 'Long Eaton' }, // name-only (existing tests rely on this)
  { id: 'opp-2', name: 'Carlton Town', home_venue: 'Stoke Lane', home_address: 'Stoke Lane, Gedling', home_postcode: 'NG4 2QT' },
]
const COMPETITIONS = [
  { id: 'comp-1', name: 'MvF XL National League', type: 'league' },
  { id: 'comp-2', name: 'County Cup', type: 'cup' },
]
const EXISTING = {
  id: 'fix-9', team_id: 't-xl', opponent_id: 'opp-1', match_date: '2026-03-08',
  kickoff: '13:00:00', home_away: 'Home', fixture_type: 'League', venue: 'Forest Rec 3G',
  address: null, w3w: null, league_name: 'MvF XL National League',
}

// Mirrors Fixtures.jsx: detail sheet open, then a button closes it and opens
// the fixture form in the same handler (the onEdit / add transition).
function Harness({ fixture = null, seasonId = 'season-1', onSaved = () => {} }) {
  const [detailOpen, setDetailOpen] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  return (
    <>
      <Sheet open={detailOpen} onClose={() => setDetailOpen(false)}>
        <div>FIXTURE DETAIL</div>
        <button onClick={() => { setDetailOpen(false); setFormOpen(true) }}>Open form</button>
      </Sheet>
      <FixtureForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={onSaved}
        teams={TEAMS}
        opponents={OPPONENTS}
        competitions={COMPETITIONS}
        seasonId={seasonId}
        fixture={fixture}
      />
    </>
  )
}

beforeEach(() => { calls.length = 0 })

describe('FixtureForm — shares the sheet/back mechanism', () => {
  test('ADD: opens from a transition, STAYS open, saves a new fixture', async () => {
    render(<StrictMode><Harness /></StrictMode>)
    await userEvent.click(screen.getByText('Open form'))
    await flush()

    expect(screen.getByText('NEW FIXTURE')).toBeInTheDocument() // didn't snap shut

    await userEvent.type(screen.getByPlaceholderText('New opponent name'), 'Carlton Town')
    await userEvent.type(screen.getByPlaceholderText(/Harvey Hadden/i), 'Forest Rec 3G')
    await userEvent.click(screen.getByRole('button', { name: /add fixture/i }))

    await waitFor(() => expect(calls.find((c) => c[0] === 'insert' && c[1] === 'fixtures')).toBeTruthy())
    const ins = calls.find((c) => c[0] === 'insert' && c[1] === 'fixtures')
    expect(ins[2]).toMatchObject({ venue: 'Forest Rec 3G', season_id: 'season-1', team_id: 't-xl', opponent_id: 'new-opp' })
  })

  test('EDIT: opens from a transition, STAYS open, prefilled with the fixture', async () => {
    render(<StrictMode><Harness fixture={EXISTING} /></StrictMode>)
    await userEvent.click(screen.getByText('Open form'))
    await flush()

    expect(screen.getByText('EDIT FIXTURE')).toBeInTheDocument() // didn't snap shut
    expect(screen.getByDisplayValue('Forest Rec 3G')).toBeInTheDocument() // prefilled

    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(calls.find((c) => c[0] === 'update' && c[1] === 'fixtures')).toBeTruthy())
  })

  test('ADD with an existing opponent persists the full payload (club_id, season_id, status)', async () => {
    const onSaved = vi.fn()
    render(<StrictMode><Harness onSaved={onSaved} /></StrictMode>)
    await userEvent.click(screen.getByText('Open form'))
    await flush()

    // pick the existing opponent from the dropdown
    const oppSelect = [...screen.getAllByRole('combobox')].find((s) => within(s).queryByText('Long Eaton'))
    await userEvent.selectOptions(oppSelect, 'opp-1')
    await userEvent.type(screen.getByPlaceholderText(/Harvey Hadden/i), 'Memorial Ground')
    await userEvent.click(screen.getByRole('button', { name: /add fixture/i }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const ins = calls.find((c) => c[0] === 'insert' && c[1] === 'fixtures')
    expect(ins).toBeTruthy()
    expect(ins[2]).toMatchObject({
      opponent_id: 'opp-1', venue: 'Memorial Ground',
      club_id: 'club-1', season_id: 'season-1', team_id: 't-xl', status: 'scheduled',
    })
  })

  test('picking an opponent with a saved home ground auto-fills the venue/address/postcode', async () => {
    const onSaved = vi.fn()
    render(<StrictMode><Harness onSaved={onSaved} /></StrictMode>)
    await userEvent.click(screen.getByText('Open form'))
    await flush()

    const oppSelect = [...screen.getAllByRole('combobox')].find((s) => within(s).queryByText('Carlton Town'))
    await userEvent.selectOptions(oppSelect, 'opp-2')

    // the venue fields are filled from the opponent's home ground, no typing
    expect(screen.getByPlaceholderText(/Harvey Hadden/i)).toHaveValue('Stoke Lane')
    expect(screen.getByDisplayValue('Stoke Lane, Gedling')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('NG18 4YD')).toHaveValue('NG4 2QT')

    await userEvent.click(screen.getByRole('button', { name: /add fixture/i }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const ins = calls.find((c) => c[0] === 'insert' && c[1] === 'fixtures')
    expect(ins[2]).toMatchObject({ opponent_id: 'opp-2', venue: 'Stoke Lane', address: 'Stoke Lane, Gedling', postcode: 'NG4 2QT' })
  })

  test('NEGATIVE: missing venue blocks the save, pops an error and flags the field', async () => {
    render(<StrictMode><Harness /></StrictMode>)
    await userEvent.click(screen.getByText('Open form'))
    await flush()

    // pick an existing opponent but leave venue blank (the user's exact case)
    const oppSelect = [...screen.getAllByRole('combobox')].find((s) => within(s).queryByText('Long Eaton'))
    await userEvent.selectOptions(oppSelect, 'opp-1')
    await userEvent.click(screen.getByRole('button', { name: /add fixture/i }))
    await flush()

    // must NOT write…
    expect(calls.find((c) => c[0] === 'insert' && c[1] === 'fixtures')).toBeFalsy()
    // …pop up a prominent error naming the missing field…
    expect(screen.getByRole('alert')).toHaveTextContent(/venue/i)
    // …flag the venue input itself…
    const venue = screen.getByPlaceholderText(/Harvey Hadden/i)
    expect(venue).toHaveAttribute('aria-invalid', 'true')
    // …and jump focus to it so it's obvious what to fix.
    expect(venue).toHaveFocus()
  })

  test('a venue postcode is geocoded into venue_lat/lng on save', async () => {
    render(<StrictMode><Harness /></StrictMode>)
    await userEvent.click(screen.getByText('Open form'))
    await flush()

    const oppSelect = [...screen.getAllByRole('combobox')].find((s) => within(s).queryByText('Long Eaton'))
    await userEvent.selectOptions(oppSelect, 'opp-1')
    await userEvent.type(screen.getByPlaceholderText(/Harvey Hadden/i), 'Forest Rec 3G')
    await userEvent.type(screen.getByPlaceholderText('NG18 4YD'), 'NG7 1AB')
    await userEvent.click(screen.getByRole('button', { name: /add fixture/i }))

    await waitFor(() => expect(calls.find((c) => c[0] === 'insert' && c[1] === 'fixtures')).toBeTruthy())
    const ins = calls.find((c) => c[0] === 'insert' && c[1] === 'fixtures')
    expect(ins[2]).toMatchObject({ postcode: 'NG7 1AB', venue_lat: 52.95, venue_lng: -1.15 })
  })

  test('linking a competition saves competition_id and denormalises its name (§1.5)', async () => {
    const onSaved = vi.fn()
    render(<StrictMode><Harness onSaved={onSaved} /></StrictMode>)
    await userEvent.click(screen.getByText('Open form'))
    await flush()

    // competition defaults to "none (friendly)"
    const comp = screen.getByLabelText('Competition')
    expect(comp).toHaveValue('')

    const oppSelect = [...screen.getAllByRole('combobox')].find((s) => within(s).queryByText('Long Eaton'))
    await userEvent.selectOptions(oppSelect, 'opp-1')
    await userEvent.type(screen.getByPlaceholderText(/Harvey Hadden/i), 'Forest Rec 3G')
    await userEvent.selectOptions(comp, 'comp-1')
    await userEvent.click(screen.getByRole('button', { name: /add fixture/i }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const ins = calls.find((c) => c[0] === 'insert' && c[1] === 'fixtures')
    expect(ins[2]).toMatchObject({ competition_id: 'comp-1', league_name: 'MvF XL National League' })
  })

  test('no competition (friendly) saves null competition_id + null league_name', async () => {
    const onSaved = vi.fn()
    render(<StrictMode><Harness onSaved={onSaved} /></StrictMode>)
    await userEvent.click(screen.getByText('Open form'))
    await flush()
    await userEvent.type(screen.getByPlaceholderText('New opponent name'), 'Friendly FC')
    await userEvent.type(screen.getByPlaceholderText(/Harvey Hadden/i), 'Rec')
    await userEvent.click(screen.getByRole('button', { name: /add fixture/i }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const ins = calls.find((c) => c[0] === 'insert' && c[1] === 'fixtures')
    expect(ins[2]).toMatchObject({ competition_id: null, league_name: null })
  })

  test('save is blocked (not a silent no-op) when no season is selected', async () => {
    render(<StrictMode><Harness seasonId={null} /></StrictMode>)
    await userEvent.click(screen.getByText('Open form'))
    await flush()

    await userEvent.type(screen.getByPlaceholderText('New opponent name'), 'Carlton Town')
    await userEvent.type(screen.getByPlaceholderText(/Harvey Hadden/i), 'Forest Rec 3G')
    await userEvent.click(screen.getByRole('button', { name: /add fixture/i }))
    await flush()

    // must NOT fire an insert with a null season_id, and must tell the user why
    expect(calls.find((c) => c[0] === 'insert' && c[1] === 'fixtures')).toBeFalsy()
    expect(screen.getByRole('alert')).toHaveTextContent(/season/i)
  })
})

// The form writes a WHOLE row back. Any column it writes that useFixtures does
// not select arrives here undefined and is saved as null — silently, on every
// edit. competition_id was exactly that until Oct 2026: 4 of that season's 11
// League fixtures had lost their competition to a routine kickoff or venue edit.
describe('FixtureForm — an edit must not wipe what the hook loaded', () => {
  const VALUES = {
    id: 'fix-9', match_date: '2026-03-08', kickoff: '13:00:00', home_away: 'Home', fixture_type: 'League',
    league_name: 'MvF XL National League', competition_id: 'comp-1', venue: 'Forest Rec 3G', address: '1 Rec Road',
    postcode: 'NG7 6HB', w3w: '///filled.count.soap', venue_lat: 52.96, venue_lng: -1.16, season_id: 'season-1',
    team_id: 't-xl', opponent_id: 'opp-1', status: 'postponed', pinned_image_id: null,
  }
  // The row exactly as the hook hands it over: only the columns it selects.
  const hookRow = () => Object.fromEntries(FIXTURE_COLUMNS.filter((c) => c in VALUES).map((c) => [c, VALUES[c]]))

  async function saveUntouched() {
    render(<StrictMode><Harness fixture={hookRow()} /></StrictMode>)
    await userEvent.click(screen.getByText('Open form'))
    await flush()
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(calls.find((c) => c[0] === 'update' && c[1] === 'fixtures')).toBeTruthy())
    return calls.find((c) => c[0] === 'update' && c[1] === 'fixtures')[2]
  }

  test('saving an edit without touching anything keeps the competition and every other column', async () => {
    const payload = await saveUntouched()
    expect(payload).toMatchObject({
      competition_id: 'comp-1', league_name: 'MvF XL National League', status: 'postponed',
      address: '1 Rec Road', postcode: 'NG7 6HB', w3w: '///filled.count.soap', venue_lat: 52.96, venue_lng: -1.16,
    })
  })

  test('every column the form writes back is one the hook selects', async () => {
    const payload = await saveUntouched()
    // club_id comes from the manager's profile, not the row.
    const written = Object.keys(payload).filter((k) => k !== 'club_id')
    expect(written.filter((k) => !FIXTURE_COLUMNS.includes(k))).toEqual([])
  })
})

// Binning a fixture cascades to its result, goals, line-up and subs (0001,
// 0012). The confirm used to mention only availability.
describe('FixtureForm — binning a fixture says what goes with it', () => {
  async function tapBin(fixture, answer) {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(answer)
    render(<StrictMode><Harness fixture={fixture} /></StrictMode>)
    await userEvent.click(screen.getByText('Open form'))
    await flush()
    await userEvent.click(screen.getByRole('button', { name: /bin this fixture/i }))
    await flush()
    const asked = confirm.mock.calls[0]?.[0] ?? ''
    confirm.mockRestore()
    return asked
  }

  test('a game with a result logged: the confirm names the score, scorers and line-up, and No deletes nothing', async () => {
    const asked = await tapBin({ ...EXISTING, hasResult: true }, false)
    expect(asked).toMatch(/result/i)
    expect(asked).toMatch(/scorers/i)
    expect(asked).toMatch(/line-up/i)
    expect(asked).toMatch(/no undo/i)
    expect(calls.find((c) => c[0] === 'delete')).toBeFalsy()
  })

  test('a game with no result: says availability and line-up go, and Yes deletes it', async () => {
    const asked = await tapBin({ ...EXISTING, hasResult: false }, true)
    expect(asked).toMatch(/availability/i)
    expect(asked).toMatch(/line-up/i)
    expect(asked).not.toMatch(/scorers/i)
    expect(calls.find((c) => c[0] === 'delete' && c[1] === 'fixtures')).toBeTruthy()
  })
})
