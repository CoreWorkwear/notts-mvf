import { describe, test, expect } from 'vitest'
import { buildFixtureCsv, csvFilename } from './csv'

const FIX = {
  team: { label: 'XL 11s' }, opponent: { name: 'Carlton Town' },
  home_away: 'Home', match_date: '2026-03-08', kickoff: '13:00:00',
  venue: 'Forest Rec 3G', fixture_type: 'League', league_name: 'MvF XL National League',
}

describe('buildFixtureCsv', () => {
  test('header carries the fixture details (home team first)', () => {
    const csv = buildFixtureCsv(FIX, [])
    const lines = csv.split('\n')
    expect(lines[0]).toContain('XL 11s v Carlton Town')
    expect(lines[1]).toContain('2026-03-08')
    expect(lines[1]).toContain('13:00 KO')
    expect(lines[1]).toContain('MvF XL National League')
    expect(lines[2]).toContain('£7')
  })

  test('away fixtures name the opponent first', () => {
    const csv = buildFixtureCsv({ ...FIX, home_away: 'Away' }, [])
    expect(csv.split('\n')[0]).toContain('Carlton Town v XL 11s')
  })

  test('one row per in player: name, preferred position, Paid Yes/No', () => {
    const csv = buildFixtureCsv(FIX, [
      { name: 'Joe Morris', preferred: 'ST', paid: true },
      { name: 'Rich King', preferred: 'CB', paid: false },
    ])
    const lines = csv.split('\n')
    expect(lines).toContain('Name,Preferred position,Paid')
    expect(lines).toContain('Joe Morris,ST,Yes')
    expect(lines).toContain('Rich King,CB,No')
  })

  test('escapes commas and quotes in names', () => {
    const csv = buildFixtureCsv(FIX, [{ name: 'Smith, "Smudger"', preferred: '', paid: false }])
    expect(csv).toContain('"Smith, ""Smudger""",,No')
  })

  test('filename is slugged from team, opponent and date', () => {
    expect(csvFilename(FIX)).toBe('nottsmvf_xl-11s_carlton-town_2026-03-08.csv')
  })
})
