import { fmtKO } from './format'
import { MATCH_FEE } from './constants'
import { teamMatchName } from './teams'

// Per-fixture CSV export (HANDOVER §10), built client-side. Header line(s) with
// the fixture details, then one row per player marked IN: full name, preferred
// position, Paid (Yes/No). The caller passes the in-only list.

function esc(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

// players: [{ name, preferred, paid }]
export function buildFixtureCsv(fixture, players) {
  const us = teamMatchName(fixture.team)
  const them = fixture.opponent?.name ?? ''
  const matchup = fixture.home_away === 'Home' ? `${us} v ${them}` : `${them} v ${us}`
  const typeLine =
    fixture.fixture_type === 'League' && fixture.league_name
      ? `${fixture.fixture_type} — ${fixture.league_name}`
      : fixture.fixture_type

  const lines = []
  lines.push(esc(`Nottinghamshire MvF — ${matchup}`))
  lines.push([esc(fixture.home_away), esc(fixture.match_date), esc(`${fmtKO(fixture.kickoff)} KO`), esc(fixture.venue), esc(typeLine)].join(','))
  lines.push(esc(`Subs: £${MATCH_FEE} per player`))
  lines.push('')
  lines.push(['Name', 'Preferred position', 'Paid'].join(','))
  for (const p of players) {
    lines.push([esc(p.name), esc(p.preferred || ''), p.paid ? 'Yes' : 'No'].join(','))
  }
  return lines.join('\n')
}

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export function csvFilename(fixture) {
  return `nottsmvf_${slug(fixture.team?.label)}_${slug(fixture.opponent?.name)}_${fixture.match_date}.csv`
}

// Trigger a client-side download (no server needed).
export function downloadCsv(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
