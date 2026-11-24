import { fmtKO } from './format'
import { MATCH_FEE } from './constants'
import { teamLabel, teamMatchName } from './teams'

// Per-fixture CSV export (HANDOVER §10), built client-side. Header line(s) with
// the fixture details, then one row per player marked IN: full name, preferred
// position, Paid (Yes/No). The caller passes the in-only list.

// Names are self-editable, and a cell starting with = + - @ (or a tab/CR) is a
// FORMULA to Excel/LibreOffice when the manager opens the export — neutralise
// with a leading apostrophe (the standard defence), then quote anything with a
// separator, quote or line break (CR included, or it splits the row).
function esc(v) {
  let s = String(v ?? '')
  if (/^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(s)) s = "'" + s
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export function buildBankAndCashCsv(entries) {
  const lines = ['Date,Player,Method,Entry,Reference,Amount (GBP),Entry ID,Original receipt ID']
  for (const entry of entries) {
    if (entry.method !== 'bank' && entry.method !== 'cash') continue
    const amount = (entry.amount_pence / 100).toFixed(2)
    lines.push([
      esc(entry.occurred_on), esc(entry.player_name), entry.method === 'bank' ? 'Bank transfer' : 'Cash',
      esc(entry.kind), esc(entry.reference), amount, esc(entry.id), esc(entry.linked_entry_id),
    ].join(','))
  }
  return lines.join('\r\n')
}

export function buildStripePayoutCsv(payouts) {
  const lines = ['Payout,Status,Date,Row,Player,Receipt reference,Method,Currency,Gross (GBP),Refunds (GBP),Fee (GBP),Net (GBP),Difference (GBP),Provider reference,Reconciliation issue']
  const amount = pence => Number.isFinite(pence) ? (pence / 100).toFixed(2) : ''
  for (const payout of payouts) {
    for (const entry of payout.lines) {
      const gbp = entry.currency === 'gbp'
      lines.push([
        esc(payout.payout_id), esc(payout.status), esc(entry.date), 'Transaction', esc(entry.player_name),
        esc(entry.receipt_reference), 'Stripe', esc(entry.currency), gbp ? amount(entry.gross_pence) : '',
        gbp ? amount(entry.refunds_pence) : '', gbp ? amount(entry.fee_pence) : '', gbp ? amount(entry.net_pence) : '',
        '', esc(entry.balance_transaction_id), esc(entry.issue),
      ].join(','))
    }
    const total = payout.breakdown
    lines.push([
      esc(payout.payout_id), esc(payout.status), esc(payout.arrival_on), 'Payout total', '', '', 'Stripe', 'gbp',
      amount(total?.gross_pence), amount(total?.refunds_pence), amount(total?.fees_pence), amount(total?.net_pence),
      amount(total?.difference_pence), '', esc(total?.issues?.join(' | ')),
    ].join(','))
  }
  return lines.join('\r\n')
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
  return `nottsmvf_${slug(teamLabel(fixture.team))}_${slug(fixture.opponent?.name)}_${fixture.match_date}.csv`
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
