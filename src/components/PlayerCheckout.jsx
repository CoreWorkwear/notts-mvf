import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
const money = pence => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100)
const requests = new Map()
const keyFor = profileId => `mvf:checkout:${profileId}`
function readRequest(key) {
  if (requests.has(key)) return requests.get(key)
  try {
    const saved = JSON.parse(sessionStorage.getItem(key))
    if (uuid.test(saved?.attempt_id) && Number.isSafeInteger(saved.amount_pence) && ['balance', 'top_up'].includes(saved.kind)) return saved
  } catch { /* Keep the in-memory recovery path when storage is unavailable. */ }
  return null
}
function writeRequest(key, request) {
  if (request) requests.set(key, request)
  else requests.delete(key)
  try {
    if (request) sessionStorage.setItem(key, JSON.stringify(request))
    else sessionStorage.removeItem(key)
  } catch { /* The in-memory request remains stable for retry. */ }
}
export function safeCheckoutUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.origin === 'https://checkout.stripe.com' && !url.username && !url.password ? url.href : null
  } catch { return null }
}
function validQuote(data) {
  return data?.currency === 'gbp' && typeof data.ready === 'boolean' && typeof data.can_pay === 'boolean' && Number.isSafeInteger(data.amount_pence) && data.amount_pence >= 0 && Number.isSafeInteger(data.balance_pence) && Number.isSafeInteger(data.min_amount_pence) && data.min_amount_pence > 0
}
async function invoke(body) {
  const { data, error } = await supabase.functions.invoke('stripe-checkout', { body })
  if (!error) return data
  let detail = data
  try { if (!detail && error.context?.json) detail = await error.context.json() } catch { /* Transport failure has no structured response. */ }
  throw Object.assign(new Error('Checkout request failed'), { detail })
}
const terminal = status => ['succeeded', 'paid', 'failed', 'expired', 'cancelled'].includes(status)

export function PlayerCheckoutReturn({ profileId }) {
  const { search } = useLocation()
  const id = new URLSearchParams(search).get('payment_attempt')
  return uuid.test(id ?? '') ? <PlayerCheckout profileId={profileId} statusOnly /> : null
}

export default function PlayerCheckout({ profileId, statusOnly = false, onStatus, redirect = url => window.location.assign(url) }) {
  const { search } = useLocation()
  const params = new URLSearchParams(search)
  const returnedAttempt = params.get('payment_attempt')
  const returnId = uuid.test(returnedAttempt ?? '') ? returnedAttempt : null
  const cancelledReturn = returnId && params.get('payment_status') === 'cancelled'
  const storageKey = keyFor(profileId)
  const [pending, setPending] = useState(() => readRequest(storageKey))
  const [readiness, setReadiness] = useState(null)
  const [readFailed, setReadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [view, setView] = useState(null)
  const [amount, setAmount] = useState('')
  const [quote, setQuote] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [payment, setPayment] = useState(null)
  const [statusError, setStatusError] = useState(false)
  const [checking, setChecking] = useState(false)
  const [statusAttempt, setStatusAttempt] = useState(0)
  const inFlight = useRef(false)
  const statusCallback = useRef(onStatus)
  statusCallback.current = onStatus

  useEffect(() => {
    if (statusOnly) return
    let active = true
    setReadFailed(false); setReadiness(null)
    invoke({ action: 'quote', kind: 'balance' }).then(data => {
      if (!validQuote(data)) throw new Error('Invalid quote')
      if (active) setReadiness(data)
    }).catch(() => { if (active) setReadFailed(true) })
    return () => { active = false }
  }, [profileId, statusOnly, attempt])

  useEffect(() => {
    if (!returnId) return
    let active = true
    setChecking(true); setStatusError(false)
    invoke({ action: 'status', attempt_id: returnId }).then(data => {
      if (data?.attempt_id !== returnId || data.currency !== 'gbp' || !Number.isSafeInteger(data.amount_pence) || typeof data.status !== 'string') throw new Error('Invalid payment status')
      if (!active) return
      setPayment(data)
      if (terminal(data.status)) {
        const stored = readRequest(storageKey)
        if (stored?.attempt_id === returnId) { writeRequest(storageKey, null); setPending(null) }
      }
      statusCallback.current?.(returnId, data.status)
    }).catch(() => { if (active) { setStatusError(true); statusCallback.current?.(returnId, 'unavailable') } }).finally(() => { if (active) setChecking(false) })
    return () => { active = false }
  }, [returnId, storageKey, statusAttempt])
  useEffect(() => {
    if (!returnId) return
    const refresh = () => setStatusAttempt(value => value + 1)
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', onVisible) }
  }, [returnId])

  async function review(kind) {
    if (inFlight.current) return
    let pence
    if (kind === 'top_up') {
      pence = Math.round(Number(amount) * 100)
      if (!/^\d+(?:\.\d{1,2})?$/.test(amount) || !Number.isSafeInteger(pence) || pence < readiness.min_amount_pence || pence > 2147483647) {
        setError(`Enter at least ${money(readiness.min_amount_pence)}, with no more than two decimal places.`); return
      }
    }
    inFlight.current = true; setBusy(true); setError('')
    try {
      const data = await invoke({ action: 'quote', kind, ...(kind === 'top_up' ? { amount_pence: pence } : {}) })
      if (!validQuote(data) || data.kind !== kind) throw new Error('Invalid quote')
      setReadiness(data); setQuote(data); setView('confirm')
    } catch { setError("Couldn't check the amount. Try again.") }
    finally { inFlight.current = false; setBusy(false) }
  }
  async function start() {
    if (inFlight.current) return
    if (!pending && (!quote?.can_pay || !quote.ready)) return
    const request = pending ?? { action: 'start', attempt_id: crypto.randomUUID(), kind: quote.kind, amount_pence: quote.amount_pence }
    if (!pending) { writeRequest(storageKey, request); setPending(request) }
    inFlight.current = true; setBusy(true); setError('')
    try {
      const data = await invoke(request)
      const destination = safeCheckoutUrl(data?.checkout_url)
      if (data?.attempt_id !== request.attempt_id || data.amount_pence !== request.amount_pence || data.currency !== 'gbp' || data.status !== 'pending' || !destination) throw new Error('Invalid Checkout destination')
      redirect(destination)
    } catch (failure) {
      if (failure.detail?.code === 'stale_quote' && validQuote(failure.detail.quote)) {
        writeRequest(storageKey, null); setPending(null); setQuote(failure.detail.quote); setReadiness(failure.detail.quote); setView('confirm')
        setError('Your balance changed. Review the new amount and confirm again before continuing.')
      } else setError("Couldn't open Checkout. Retry the same payment to check and continue once.")
    } finally { inFlight.current = false; setBusy(false) }
  }

  const showActions = !statusOnly && readiness?.ready
  if (!returnId && !showActions && !readFailed) return null
  return <div className="player-checkout mt-3">
    {returnId && <section aria-label="Online payment status" className="col gap-2">
      {cancelledReturn && <p>You returned from Checkout. This does not confirm a payment.</p>}
      {checking ? <p role="status">Checking payment status…</p> : statusError ? <p role="alert">Couldn't check this payment. Your balance and statement show confirmed transactions only.</p> : payment && <p role="status">{['succeeded', 'paid'].includes(payment.status) ? `Payment confirmed: ${money(payment.amount_pence)}.${onStatus ? ' Your balance and statement are being refreshed.' : ''}` : payment.status === 'failed' ? 'Payment failed. No payment has been confirmed.' : payment.status === 'expired' ? 'Checkout expired. No payment has been confirmed.' : payment.status === 'cancelled' ? 'Payment cancelled. No payment has been confirmed.' : 'Payment pending. Your balance changes only after payment is confirmed.'}</p>}
      <button className="btn btn-ghost btn-block" disabled={checking} onClick={() => setStatusAttempt(value => value + 1)}>Check payment status</button>
    </section>}
    {!statusOnly && readFailed && <div role="alert" className="mt-2"><p>Couldn't load online payment options.</p><button className="btn btn-ghost btn-block mt-2" onClick={() => setAttempt(value => value + 1)}>Retry payment options</button></div>}
    {showActions && <>
      {pending ? <div className="col gap-2 mt-3"><p>Continue your {money(pending.amount_pence)} payment. The same payment attempt will be reused.</p><button className="btn btn-primary btn-block" disabled={busy} onClick={start}>{busy ? 'Opening Checkout…' : 'Retry Checkout'}</button></div> : <>
        {!view && <div className="col gap-2">
          {readiness.balance_pence < 0 && <button className="btn btn-primary btn-block" disabled={busy} onClick={() => review('balance')}>{busy ? 'Checking amount…' : 'Pay balance'}</button>}
          <button className={`btn ${readiness.balance_pence < 0 ? 'btn-ghost' : 'btn-primary'} btn-block`} disabled={busy} onClick={() => { setView('amount'); setError('') }}>Add money</button>
        </div>}
        {view === 'amount' && <form className="col gap-3" onSubmit={event => { event.preventDefault(); review('top_up') }}><label className="field">Amount to add (£)<input className="input mono" inputMode="decimal" required value={amount} disabled={busy} onChange={event => setAmount(event.target.value)} /></label><p className="muted">Minimum {money(readiness.min_amount_pence)}.</p><button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Checking amount…' : 'Review amount'}</button></form>}
        {view === 'confirm' && quote && <div className="col gap-3">
          <p className="mono">Amount: {money(quote.amount_pence)}</p>
          {!quote.can_pay ? <p>{quote.kind === 'balance' && quote.balance_pence >= 0 ? 'No balance payment is needed. You can choose Add money to top up your account.' : quote.amount_pence < quote.min_amount_pence ? `This amount is below the ${money(quote.min_amount_pence)} online payment minimum. Choose Add money to authorise a larger amount.` : 'This amount cannot be paid online. Check your balance or choose Add money.'}</p> : <><p>Continue to Stripe to authorise this payment to the club.</p><button className="btn btn-primary btn-block" disabled={busy} onClick={start}>{busy ? 'Opening Checkout…' : 'Continue to secure Checkout'}</button></>}
          {quote.kind === 'balance' && <button className="btn btn-ghost btn-block" onClick={() => { setView('amount'); setError('') }}>Add money</button>}
        </div>}
        {view && <button className="btn btn-ghost btn-block mt-2" disabled={busy} onClick={() => { setView(null); setQuote(null); setError('') }}>Cancel</button>}
      </>}
      {error && <p className="field-error mt-2" role="alert">{error}</p>}
    </>}
  </div>
}
