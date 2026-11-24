import { describe, test, expect } from 'vitest'
import { buildBankAndCashCsv, buildFixtureCsv, csvFilename } from './csv'

test('bank and cash CSV exports signed period entries and protects text cells', () => {
  const date = '2026-11-24'
  const receipts = [
    { id: 'bank-1', method: 'bank', kind: 'receipt', player_name: 'Hall, Sam', reference: ' =value', occurred_on: date, amount_pence: 1800 },
    { id: 'cash-1', method: 'cash', kind: 'receipt', player_name: 'Taylor', occurred_on: date, amount_pence: 500 },
    { id: 'reverse-1', method: 'bank', kind: 'reversal', player_name: 'Hall, Sam', linked_entry_id: 'old-bank', occurred_on: date, amount_pence: -700 },
    { id: 'stripe-1', method: 'stripe', kind: 'receipt', player_name: 'Online', occurred_on: date, amount_pence: 1500 },
  ]
  expect(buildBankAndCashCsv(receipts).split('\r\n').slice(1)).toEqual([
    `${date},"Hall, Sam",Bank transfer,receipt,' =value,18.00,bank-1,`,
    `${date},Taylor,Cash,receipt,,5.00,cash-1,`,
    `${date},"Hall, Sam",Bank transfer,reversal,,-7.00,reverse-1,old-bank`,
  ])
})

const FIX = {
  team: { label: 'XL 11s' }, opponent: { name: 'Carlton Town' },
  home_away: 'Home', match_date: '2026-03-08', kickoff: '13:00:00',
  venue: 'Forest Rec 3G', fixture_type: 'League', league_name: 'MvF XL National League',
}

describe('buildFixtureCsv', () => {
  test('header carries the fixture details (home team first)', () => {
    const csv = buildFixtureCsv(FIX, [])
    const lines = csv.split('\n')
    expect(lines[0]).toContain('1st Team v Carlton Town')
    expect(lines[1]).toContain('2026-03-08')
    expect(lines[1]).toContain('13:00 KO')
    expect(lines[1]).toContain('MvF XL National League')
    expect(lines[2]).toContain('£7')
  })

  test('away fixtures name the opponent first', () => {
    const csv = buildFixtureCsv({ ...FIX, home_away: 'Away' }, [])
    expect(csv.split('\n')[0]).toContain('Carlton Town v 1st Team')
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
    expect(csvFilename(FIX)).toBe('nottsmvf_1st-team_carlton-town_2026-03-08.csv')
  })
})

// A player's name is self-editable (ProfileEdit). A name that starts with
// = + - @ (or a tab/CR) is a FORMULA to Excel/LibreOffice when the manager
// opens the Who's In export — "=HYPERLINK(...)" or "+cmd|..." runs. Neutralise
// with a leading apostrophe (the standard defence) and quote bare CRs.
describe('buildFixtureCsv — spreadsheet formula injection', () => {
  test.each(['=1+1', '+1', '-1', '@SUM(1)', '\t=1', '\r=1'])('neutralises a formula-leading name %j', (name) => {
    const row = buildFixtureCsv(FIX, [{ name, preferred: '', paid: false }]).split('\n').at(-1)
    const first = row.startsWith('"') ? row.slice(1) : row
    expect(first.startsWith("'")).toBe(true)
  })

  test('a bare CR inside a name is quoted so it cannot break the row', () => {
    expect(buildFixtureCsv(FIX, [{ name: 'a\rb', preferred: '', paid: false }])).toContain('"a\rb"')
  })

  test('ordinary names are untouched', () => {
    expect(buildFixtureCsv(FIX, [{ name: 'Joe Morris', preferred: 'ST', paid: true }])).toContain('Joe Morris,ST,Yes')
  })
})
