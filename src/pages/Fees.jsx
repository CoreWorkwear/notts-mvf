import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Loader from '../components/Loader'
import PageHead from '../components/PageHead'
import { useAuth } from '../context/AuthContext'
import { usePaymentsRelease } from '../hooks/usePaymentsRelease'
import { parseDate, todayISO } from '../lib/format'
import { supabase } from '../lib/supabase'

const rateLabels = {
  first_team: 'First Team match subs',
  community: 'Community match subs',
  training: 'Training session subs',
}
const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' })

export default function Fees() {
  const { user, profile } = useAuth()
  const release = usePaymentsRelease(user?.id, profile?.club_id)
  const [load, setLoad] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const retry = () => setAttempt(value => value + 1)

  useEffect(() => {
    if (!release.enabled) return
    let current = true
    supabase.rpc('get_club_fee_rates').then(({ data, error }) => {
      if (current) setLoad(error ? { error: true } : { rates: data })
    }, () => { if (current) setLoad({ error: true }) })
    return () => { current = false }
  }, [release.enabled, attempt])

  if (release.loading && !load) return <Loader label="Loading fees…" />
  return <div className="page">
    <Link className="btn btn-ghost" to="/manage">Back to Club admin</Link>
    <PageHead kicker="CLUB SETTINGS" title="Fees" />
    {release.error ? <div className="card pad mt-4" role="alert">
      <p>Couldn't check whether club accounts are available.</p>
      <button type="button" className="btn btn-ghost mt-2" onClick={release.retry}>Try again</button>
    </div> : !release.enabled ? <p role="status" className="mt-4">Club accounts are unavailable.</p>
      : !load ? <p role="status" className="mt-4">Loading fee rates…</p>
        : load.error ? <div className="card pad mt-4" role="alert">
          <p>Couldn't load the fee rates.</p>
          <button type="button" className="btn btn-ghost mt-2" onClick={retry}>Try again</button>
        </div> : <div className="col gap-3 mt-4">
          {load.rates.map(rate => <FeeCard key={rate.category} rate={rate} onSaved={retry} />)}
        </div>}
  </div>
}

function FeeCard({ rate, onSaved }) {
  const { category, current_rate: current, next_rate: next } = rate
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function edit() {
    setAmount(current ? (current.amount_pence / 100).toFixed(2) : '')
    setDate(todayISO())
    setStatus('')
    setError('')
    setEditing(true)
  }

  async function save(event) {
    event.preventDefault()
    if (saving) return
    const pence = Math.round(Number(amount) * 100)
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount) || pence > 2147483647 || !date) {
      setError('Enter a GBP amount with up to two decimal places and a start date.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const { error } = await supabase.rpc('set_club_fee_rate', {
        p_category: category, p_amount_pence: pence, p_effective_from: date,
      })
      if (error) {
        setError(error.code === '23505' ? 'A different amount is already set for this date. Choose another start date.'
          : error.code === '42501' ? 'Club accounts are unavailable.'
            : "Couldn't save the rate. Try again.")
        return
      }
      setEditing(false)
      setStatus('Fee rate saved.')
      onSaved()
    } catch {
      setError("Couldn't save the rate. Try again.")
    } finally {
      setSaving(false)
    }
  }

  return <section className="card pad" aria-labelledby={`fee-${category}`}>
    <h2 id={`fee-${category}`}>{rateLabels[category]}</h2>
    <p className="mt-2"><strong>Current</strong> {current ? <Rate rate={current} /> : 'Not set'}</p>
    {next && <p className="dim mt-1"><strong>Next</strong> <Rate rate={next} /></p>}
    {status && <p className="mt-2" role="status">{status}</p>}
    {editing ? <form className="col gap-3 mt-3" onSubmit={save}>
      <label className="field">New amount (£)<input className="input mono" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} required /></label>
      <label className="field">Effective from<input className="input" type="date" value={date} onChange={event => setDate(event.target.value)} required /></label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save rate'}</button>
      <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
    </form> : <button type="button" className="btn btn-ghost mt-3" onClick={edit}>Set rate</button>}
  </section>
}

function Rate({ rate }) {
  return <><span className="mono">{gbp.format(rate.amount_pence / 100)}</span>
    {' from '}<time dateTime={rate.effective_from}>{dateFormat.format(parseDate(rate.effective_from))}</time></>
}
