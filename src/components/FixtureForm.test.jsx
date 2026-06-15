import { StrictMode, useState } from 'react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Sheet from './Sheet'
import FixtureForm from './FixtureForm'

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

  test('league is a placeholder hint (not a pre-filled value) but still saves the team default', async () => {
    const onSaved = vi.fn()
    render(<StrictMode><Harness onSaved={onSaved} /></StrictMode>)
    await userEvent.click(screen.getByText('Open form'))
    await flush()

    // the box looks EMPTY, with the team's league shown only as a hint
    const league = screen.getByPlaceholderText('MvF XL National League')
    expect(league).toHaveValue('')

    const oppSelect = [...screen.getAllByRole('combobox')].find((s) => within(s).queryByText('Long Eaton'))
    await userEvent.selectOptions(oppSelect, 'opp-1')
    await userEvent.type(screen.getByPlaceholderText(/Harvey Hadden/i), 'Forest Rec 3G')
    await userEvent.click(screen.getByRole('button', { name: /add fixture/i }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const ins = calls.find((c) => c[0] === 'insert' && c[1] === 'fixtures')
    expect(ins[2].league_name).toBe('MvF XL National League') // defaulted from the team on save
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
