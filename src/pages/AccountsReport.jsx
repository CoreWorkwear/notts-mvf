import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { usePaymentsRelease } from '../hooks/usePaymentsRelease'
import './AccountsReport.css'

const CATEGORIES = { first_team: 'First Team', community: 'Community', training: 'Training', fines: 'Fines' }
const METHODS = { stripe: 'Stripe', bank: 'Bank transfer', cash: 'Cash' }
const money = pence => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100)
const signed = pence => `${pence > 0 ? '+' : ''}${money(pence)}`
const date = value => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }).format(new Date(value))
const londonToday = () => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/London' }).format(new Date())
function revealCharge(id) {
  const entry = document.getElementById(`finance-entry-${id}`)
  if (!entry) return
  const details = entry.closest('details')
  if (details) details.open = true
  entry.focus({ preventScroll: true }); entry.scrollIntoView?.({ block: 'center' })
}

export default function AccountsReport() {
  const { user, profile, isAdmin } = useAuth()
  const release = usePaymentsRelease(user?.id, profile?.club_id)
  const [to, setTo] = useState(londonToday)
  const [from, setFrom] = useState(() => `${londonToday().slice(0, 7)}-01`)
  const [period, setPeriod] = useState(() => ({ from, to }))
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [invalid, setInvalid] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [target, setTarget] = useState(null)

  useEffect(() => {
    if (!isAdmin || !release.enabled) { setReport(null); return }
    let active = true
    setLoading(true); setError(''); setReport(null)
    Promise.resolve().then(() => supabase.rpc('get_activity_finance_report', { p_from: period.from, p_to: period.to })).then(({ data, error }) => {
      if (error || !data?.totals || !Array.isArray(data.categories) || !data.receipts) throw error ?? new Error('Invalid report')
      if (active) setReport(data)
    }).catch(() => { if (active) setError("Couldn't load the report. The totals are unavailable.") }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [period, attempt, isAdmin, release.enabled, user?.id, profile?.club_id])

  useEffect(() => {
    if (report && target && !loading) revealCharge(target)
  }, [report, target, loading])

  function show(event) {
    event.preventDefault()
    if (!from || !to || from > to) { setInvalid('Choose a start date on or before the end date.'); return }
    setInvalid(''); setTarget(null); setPeriod({ from, to })
  }
  function original(entry) {
    setTarget(entry.original_charge_id || entry.linked_entry_id)
    revealCharge(entry.original_charge_id || entry.linked_entry_id)
    const originalDate = entry.original_occurred_on
    if (originalDate && (originalDate < period.from || originalDate > period.to)) {
      setFrom(originalDate); setTo(originalDate); setPeriod({ from: originalDate, to: originalDate })
    }
  }

  return <div className="page finance-report">
    <h1 className="display">Activity charges</h1>
    {!isAdmin ? <p role="alert" className="mt-3">Only a club manager can view this report.</p> : release.loading && !release.enabled ? <p role="status" className="mt-3">Loading player accounts…</p> : release.error ? <div role="alert" className="mt-3"><p>Couldn't check player accounts.</p><button className="btn btn-ghost mt-2" onClick={release.retry}>Try again</button></div> : !release.enabled ? <p role="status" className="mt-3">Player accounts are currently unavailable.</p> : <>
      <form className="report-filter mt-3" onSubmit={show} aria-label="Reporting period">
        <label className="field">From<input className="input" type="date" required value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="field">To<input className="input" type="date" required value={to} onChange={e => setTo(e.target.value)} /></label>
        <button className="btn btn-primary" type="submit">Show report</button>
      </form>
      <p className="muted mt-2">Both dates are included, using Europe/London dates.</p>
      {invalid && <p className="field-error mt-2" role="alert">{invalid}</p>}
      {loading ? <p className="mt-4" role="status">Loading report…</p> : error ? <div className="mt-4" role="alert"><p>{error}</p><button className="btn btn-ghost mt-2" onClick={() => setAttempt(a => a + 1)}>Try again</button></div> : report && <>
        <p className="mono mt-4">{date(report.from)} – {date(report.to)}</p>
        <h2 className="mt-4">Charge summary</h2>
        <div className="report-table-wrap mt-2" role="region" aria-label="Activity charge totals" tabIndex={0}>
          <table className="report-table"><caption className="sr-only">Activity charge totals</caption>
            <thead><tr><th scope="col">Activity</th><th scope="col">Charges raised</th><th scope="col">Corrections</th><th scope="col">Net charges</th></tr></thead>
            <tbody>{Object.entries(CATEGORIES).map(([key, label]) => {
              const category = report.categories.find(c => c.category === key)
              return <tr key={key}><th scope="row">{label}</th><td className="mono">{money(category?.charges_pence ?? 0)}</td><td className="mono">{signed(category?.corrections_pence ?? 0)}</td><td className="mono">{money(category?.net_charges_pence ?? 0)}</td></tr>
            })}</tbody>
            <tfoot><tr><th scope="row">Grand total</th><td className="mono">{money(report.totals.charges_pence)}</td><td className="mono">{signed(report.totals.corrections_pence)}</td><td className="mono">{money(report.totals.net_charges_pence)}</td></tr></tfoot>
          </table>
        </div>
        {Object.entries(CATEGORIES).map(([key, label]) => <details className="report-detail mt-3" key={key}>
          <summary>{label} details</summary>
          <ul className="report-lines">{(report.categories.find(c => c.category === key)?.entries ?? []).map(entry => <li key={entry.id} id={`finance-entry-${entry.id}`} tabIndex={-1}>
            <div className="report-line-head"><strong>{entry.player_name}</strong><span className="mono">{signed(entry.amount_pence)}</span></div>
            <p>{entry.description || entry.activity_snapshot?.description || label}</p>
            <p className="muted"><time dateTime={entry.occurred_on}>{date(entry.occurred_on)}</time>{entry.activity_id ? ` · ${entry.activity_type || 'Activity'} ${entry.activity_id}` : ''}</p>
            {entry.linked_entry_id && <div className="mt-2"><p className="muted">Correction of {entry.original_charge_id || entry.linked_entry_id}{entry.original_occurred_on ? ` · ${date(entry.original_occurred_on)}` : ''}</p><button type="button" className="btn btn-ghost mt-2" onClick={() => original(entry)}>View original charge</button></div>}
          </li>)}</ul>
          {!(report.categories.find(c => c.category === key)?.entries.length) && <p className="muted mt-2">No charges or corrections in this period.</p>}
        </details>)}
        <section className="mt-5" aria-labelledby="club-receipts-heading">
          <h2 id="club-receipts-heading">Club receipts</h2>
          <p className="muted mt-2">Confirmed money received is separate from activity charges.</p>
          <dl className="report-receipt-totals mt-3"><div><dt>Gross receipts</dt><dd className="mono">{money(report.receipts.gross_pence)}</dd></div><div><dt>Refunds</dt><dd className="mono">{money(report.receipts.refunds_pence)}</dd></div><div><dt>Receipt reversals</dt><dd className="mono">{money(report.receipts.reversals_pence)}</dd></div><div><dt>Net receipts</dt><dd className="mono">{money(report.receipts.net_pence)}</dd></div></dl>
          <ul className="report-lines mt-3">{report.receipts.methods.map(method => <li key={method.method}><strong>{METHODS[method.method] || method.method}</strong><p className="mono">Gross {money(method.gross_pence)} · Refunds {money(method.refunds_pence)} · Reversals {money(method.reversals_pence)} · Net {money(method.net_pence)}</p></li>)}</ul>
          <details className="report-detail mt-3"><summary>Receipt reconciliation details</summary><ul className="report-lines">{report.receipts.entries.map(entry => <li key={entry.id}><div className="report-line-head"><strong>{entry.player_name}</strong><span className="mono">{signed(entry.amount_pence)}</span></div><p>{entry.description || entry.kind}</p><p className="muted">{date(entry.occurred_on)} · {METHODS[entry.method] || entry.method} · {entry.kind.replaceAll('_', ' ')}</p>{entry.reference && <p>Reference: {entry.reference}</p>}{entry.linked_entry_id && <p className="muted">Linked receipt: {entry.linked_entry_id}</p>}</li>)}</ul>{report.receipts.entries.length === 0 && <p className="muted mt-2">No receipts, refunds or receipt reversals in this period.</p>}</details>
        </section>
      </>}
    </>}
  </div>
}
