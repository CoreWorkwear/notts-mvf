import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePaymentsRelease } from '../hooks/usePaymentsRelease'
import { parseDate, todayISO } from '../lib/format'
import { supabase } from '../lib/supabase'
import { buildStripePayoutCsv, downloadCsv } from '../lib/csv'
import PageHead from '../components/PageHead'
import './AccountsReport.css'

const currency = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const money = pence => Number.isFinite(pence) ? currency.format(pence / 100) : '—'
const dates = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' })
const date = value => value ? dates.format(parseDate(value)) : 'Awaiting date'
const statuses = { paid: 'Paid by Stripe', failed: 'Failed payout', canceled: 'Cancelled payout',
  pending: 'Pending payout', in_transit: 'In transit' }
const debitStatuses = { paid: 'Bank debit collected', failed: 'Failed bank debit', canceled: 'Cancelled bank debit',
  pending: 'Pending bank debit', in_transit: 'Bank debit in transit' }

export default function StripePayouts() {
  const { user, profile, isAdmin } = useAuth()
  const release = usePaymentsRelease(user?.id, profile?.club_id)
  const [to, setTo] = useState(todayISO)
  const [from, setFrom] = useState(() => todayISO().slice(0, 7) + '-01')
  const [query, setQuery] = useState(() => ({ from, to, action: 'list' }))
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dateError, setDateError] = useState('')
  const canRead = isAdmin && release.enabled
  const identity = `${user?.id}:${profile?.club_id}`
  const report = snapshot?.identity === identity ? snapshot.report : null

  useEffect(() => {
    if (!canRead) { setSnapshot(null); return }
    let active = true
    setLoading(true)
    setError('')
    setSnapshot(previous => previous?.identity === identity && previous.report.from === query.from &&
      previous.report.to === query.to ? previous : null)
    supabase.functions.invoke('stripe-payout-reconciliation', { body: query }).then(({ data, error }) => {
      if (error || !Array.isArray(data?.payouts)) throw error ?? new Error('Payout data unavailable')
      if (active) setSnapshot({ identity, report: data })
    }).catch(() => {
      if (active) setError("Couldn't load Stripe payouts. Any figures shown were saved before this request.")
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [canRead, query, identity])

  function load(action) {
    if (!from || !to || from > to) { setDateError('Choose a start date on or before the end date.'); return }
    setDateError('')
    setQuery({ from, to, action })
  }

  return <div className="page finance-report">
    <Link className="btn btn-ghost" to="/manage">Back to Club admin</Link>
    <PageHead kicker="CLUB SETTINGS" title="Stripe payouts" />
    {!canRead ? <p className="mt-4" role="status">{release.loading ? 'Checking club accounts…' : 'Stripe payouts are unavailable.'}</p> : <>
      <form className="report-filter mt-3" onSubmit={event => { event.preventDefault(); load('list') }} aria-label="Payout period">
        <label className="field">From<input type="date" className="input" value={from} onChange={event => setFrom(event.target.value)} required /></label>
        <label className="field">To<input type="date" className="input" value={to} onChange={event => setTo(event.target.value)} required /></label>
        <button className="btn btn-primary" type="submit">Show payouts</button>
      </form>
      {dateError && <p className="mt-2" role="alert">{dateError}</p>}
      <button className="btn btn-ghost mt-3" type="button" disabled={loading} onClick={() => load('refresh')}>Refresh from Stripe</button>
      {loading && <p role="status" className="mt-2">Loading payouts…</p>}
      {error && <p role="alert" className="mt-2">{error}</p>}
      {report && <>
        {report.mode === 'test' && <p className="muted mt-3">Sandbox</p>}
        <p className="mt-3">{date(report.from)} – {date(report.to)}</p>
        {report.payouts.length === 0 ? <p className="mt-3">No Stripe payouts in this period.</p> : <>
          <button className="btn btn-ghost mt-3" type="button" onClick={() =>
            downloadCsv(`nottsmvf_stripe_payouts_${report.from}_${report.to}.csv`, buildStripePayoutCsv(report.payouts))}>
            Export period CSV
          </button>
          {report.payouts.map(payout => <Payout key={payout.payout_id} payout={payout} />)}
        </>}
      </>}
      <Link className="btn btn-ghost mt-4" to="/manage/accounts-report">Bank and cash receipts</Link>
    </>}
  </div>
}

function Payout({ payout }) {
  const totals = payout.breakdown
  const gbp = payout.currency === 'gbp'
  const debit = payout.amount_pence < 0
  const label = debit ? debitStatuses[payout.status] ?? 'Bank debit' : statuses[payout.status] ?? 'Stripe payout'
  const payoutAmount = gbp ? money(payout.amount_pence) : payout.currency?.toUpperCase() || 'Unknown currency'
  return <details className="report-detail mt-3">
    <summary>{label} · {payoutAmount} · {date(payout.arrival_on)}</summary>
    <p className="muted mt-2">{debit ? 'Expected bank debit' : 'Expected bank arrival'} {date(payout.arrival_on)}. Reference {payout.payout_id}</p>
    <h2 className="mt-3">{totals?.reconciled ? 'Reconciled to Stripe' : 'Reconciliation outstanding'}</h2>
    {totals && gbp && totals.component_net_available !== false && <dl className="report-receipt-totals mt-3">
      <div><dt>Gross</dt><dd>{money(totals.gross_pence)}</dd></div>
      <div><dt>Refunds</dt><dd>{money(totals.refunds_pence)}</dd></div>
      <div><dt>Stripe fees</dt><dd>{money(totals.fees_pence)}</dd></div>
      <div><dt>Other movements</dt><dd>{money(totals.other_pence)}</dd></div>
      <div><dt>Net total</dt><dd>{money(totals.net_pence)}</dd></div>
      <div><dt>Difference</dt><dd>{money(totals.difference_pence)}</dd></div>
    </dl>}
    {!!totals?.issues?.length && <ul className="mt-3">{totals.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    <ul className="report-lines mt-3">{payout.lines.map(line => <li key={line.balance_transaction_id}>
      <div className="report-line-head"><strong>{line.player_name || line.reporting_category || line.type}</strong>
        <span className="mono">{line.currency === 'gbp' ? money(line.net_pence) : line.currency?.toUpperCase() || 'Unknown currency'}</span></div>
      <p className="muted">{date(line.date)} · Stripe{line.receipt_reference ? ` · ${line.receipt_reference}` : ''}</p>
      {line.currency === 'gbp' && <p className="mono">Gross {money(line.gross_pence)} · Refund {money(line.refunds_pence)} · Fee {money(line.fee_pence)}</p>}
      {line.issue && <p>{line.issue}</p>}
    </li>)}</ul>
    <button className="btn btn-ghost mt-3" type="button" onClick={() =>
      downloadCsv(`nottsmvf_${payout.payout_id}.csv`, buildStripePayoutCsv([payout]))}>
      Export payout CSV
    </button>
  </details>
}
