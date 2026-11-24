import { useCallback, useEffect, useRef, useState } from 'react'
import ManagerAccountChange, { pendingAccountChange } from './ManagerAccountChange'
import { todayISO } from '../lib/format'
import { supabase } from '../lib/supabase'
import './PlayerAccount.css'
import PlayerCheckout from './PlayerCheckout'

const money = pence => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Math.abs(pence) / 100)
const balanceLabel = pence => pence === 0 ? 'Settled' : `${money(pence)} ${pence < 0 ? 'owed' : 'in credit'}`
const dateLabel = value => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }).format(new Date(value))
const drafts = new Map()
const draftKey = (profileId, actorId) => `mvf:receipt:${actorId}:${profileId}`
function readDraft(key) {
  if (drafts.has(key)) return drafts.get(key)
  try {
    const draft = JSON.parse(sessionStorage.getItem(key))
    if (draft?.p_request_id && Number.isSafeInteger(draft.p_amount_pence)) return draft
  } catch { /* Session storage may be unavailable. The in-memory draft survives sheet close. */ }
  return null
}
function saveDraft(key, draft) {
  if (draft) drafts.set(key, draft)
  else drafts.delete(key)
  try {
    if (draft) sessionStorage.setItem(key, JSON.stringify(draft))
    else sessionStorage.removeItem(key)
  } catch { /* Keep the in-memory recovery path. */ }
}

export default function PlayerAccount({ profileId, actorId = '', canRecord = false, canPay = false, active = true, players = [], initialEntryId }) {
  const panel = useRef(null)
  const focusedEntries = useRef(new Set())
  const paymentRefreshes = useRef(new Set())
  const [account, setAccount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [receipt, setReceipt] = useState(false)
  const [correction, setCorrection] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    setAccount(null); setReceipt(false); setCorrection(false); setNotice('')
    paymentRefreshes.current.clear()
  }, [profileId, active])
  const refreshPayment = useCallback((id, status) => {
    const key = `${id}:${status}`
    if (paymentRefreshes.current.has(key)) return
    paymentRefreshes.current.add(key)
    setAttempt(value => value + 1)
  }, [])
  useEffect(() => {
    if (!active || !profileId) return
    let on = true
    setLoading(true); setError(false)
    Promise.resolve().then(() => supabase.rpc('get_player_account', { p_profile_id: profileId })).then(({ data, error }) => {
      if (error || !Number.isSafeInteger(data?.balance_pence) || !Array.isArray(data?.entries)) throw error ?? new Error('Invalid account')
      if (on) setAccount(data)
    }).catch(() => { if (on) { setAccount(null); setError(true) } }).finally(() => { if (on) setLoading(false) })
    return () => { on = false }
  }, [profileId, active, attempt])
  useEffect(() => {
    if (!active || receipt || correction) return
    const refresh = () => setAttempt(value => value + 1)
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active, receipt, correction])
  useEffect(() => {
    if (loading || !account || !initialEntryId) return
    const key = `${profileId}:${initialEntryId}`
    if (focusedEntries.current.has(key)) return
    const entry = [...(panel.current?.querySelectorAll('.account-entry') ?? [])].find(element => element.id === `statement-entry-${initialEntryId}`)
    if (!entry) return
    focusedEntries.current.add(key)
    entry.scrollIntoView?.({ block: 'nearest' }); entry.focus({ preventScroll: true })
  }, [loading, account, initialEntryId, profileId])
  if (!active) return null
  const actorNames = new Map(players.map(player => [player.id, [player.first_name, player.last_name].join(" ")]))
  return <section ref={panel} className="player-account mt-5" aria-label="Player account">
    <h2>Balance and statement</h2>
    {loading ? <p role="status" className="muted mt-2">Loading your account…</p> : error ? <div role="alert" className="mt-2">
      <p>Couldn't load the account. Your balance is unavailable.</p>
      <button className="btn btn-ghost mt-2" onClick={() => setAttempt(a => a + 1)}>Try again</button>
    </div> : account && <>
      <p className="account-balance mono mt-2">{balanceLabel(account.balance_pence)}</p>
      {canPay && <PlayerCheckout key={profileId} profileId={profileId} onStatus={refreshPayment} />}
      {notice && <p role="status" className="mt-2">{notice}</p>}
      {canRecord && !receipt && !correction && <button className="btn btn-primary btn-block mt-3" onClick={() => { setReceipt(true); setNotice('') }}>{readDraft(draftKey(profileId, actorId)) ? 'Resume receipt' : 'Record receipt'}</button>}
      {receipt && <ReceiptForm profileId={profileId} actorId={actorId} onSaved={() => { setReceipt(false); setNotice('Receipt recorded.'); setAttempt(a => a + 1) }} onCancel={() => setReceipt(false)} />}
      {canRecord && !receipt && !correction && <button className="btn btn-ghost btn-block mt-2" onClick={() => { setCorrection(true); setNotice('') }}>
        {pendingAccountChange(actorId, profileId) ? 'Resume change' : 'Fine or correction'}
      </button>}
      {correction && <ManagerAccountChange profileId={profileId} actorId={actorId} entries={account.entries} players={players}
        onSaved={() => { setCorrection(false); setNotice('Account updated.'); setAttempt(a => a + 1) }}
        onClose={() => setCorrection(false)} />}
      <h3 className="mt-5">Statement</h3>
      {account.entries.length === 0 ? <p className="muted mt-2">No transactions yet.</p> : <>
        <p className="muted mt-2 account-hint" id={`statement-hint-${profileId}`}>Transactions in posting order.</p>
        <div className="account-statement mt-2" role="region" aria-label="Account transactions" aria-describedby={`statement-hint-${profileId}`} tabIndex={0}>
          <ol>{account.entries.map(entry => <li key={entry.id} id={`statement-entry-${entry.id}`} tabIndex={-1} className="account-entry">
            <div className="account-entry-main"><strong>{entry.description || entry.kind.replaceAll('_', ' ')}</strong>
              <span className="mono">{entry.amount_pence < 0 ? '−' : '+'}{money(entry.amount_pence)}</span></div>
            <p className="muted account-entry-meta"><time dateTime={entry.occurred_on || entry.occurred_at}>{dateLabel(entry.occurred_on || entry.occurred_at)}</time> · {entry.source === 'cash' ? 'Cash' : entry.source === 'bank' ? 'Bank transfer' : entry.kind.replaceAll('_', ' ')}</p>
            {entry.reference && <p className="account-entry-meta">Reference: {entry.reference}</p>}
            {entry.linked_entry_id && <button className="btn btn-ghost mt-2" type="button" onClick={() => {
              const original = document.getElementById(`statement-entry-${entry.linked_entry_id}`)
              original?.scrollIntoView({ block: 'nearest' })
              original?.focus({ preventScroll: true })
            }}>View original transaction</button>}
            {canRecord && entry.actor_id && <p className="muted account-entry-meta">Recorded {dateLabel(entry.posted_at)} by {actorNames.get(entry.actor_id) ?? entry.actor_id}</p>}
            <p className="muted account-entry-meta">Balance: <span className="mono">{balanceLabel(entry.running_balance_pence)}</span></p>
          </li>)}</ol>
        </div>
      </>}
    </>}
  </section>
}

function ReceiptForm({ profileId, actorId, onSaved, onCancel }) {
  const key = draftKey(profileId, actorId)
  const [draft] = useState(() => readDraft(key))
  const [amount, setAmount] = useState(draft ? (draft.p_amount_pence / 100).toFixed(2) : '')
  const [method, setMethod] = useState(draft?.p_method ?? 'cash')
  const [reference, setReference] = useState(draft?.p_reference ?? '')
  const [receivedOn, setReceivedOn] = useState(draft?.p_received_on ?? todayISO())
  const [description, setDescription] = useState(draft?.p_description ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [locked, setLocked] = useState(!!draft)
  const pending = useRef(draft)
  // A recovered request may already have committed. Later business refusals
  // cannot prove that the original attempt failed, so never replace its ID.
  const ambiguous = useRef(!!draft)
  const saving = useRef(false)
  async function save(event) {
    event.preventDefault()
    if (saving.current) return
    if (!pending.current) {
      if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || Number(amount) * 100 > 2147483647) {
        setError('Enter an amount greater than £0, with no more than two decimal places.'); return
      }
      pending.current = { p_request_id: crypto.randomUUID(), p_profile_id: profileId, p_amount_pence: Math.round(Number(amount) * 100), p_method: method, p_reference: reference.trim(), p_received_on: receivedOn, p_description: description.trim() || null }
      saveDraft(key, pending.current)
      setLocked(true)
    }
    saving.current = true; setBusy(true); setError('')
    try {
      const { error } = await supabase.rpc('record_account_receipt', pending.current)
      if (error) throw error
      saveDraft(key, null)
      onSaved()
    } catch (failure) {
      if (['42501', '22023'].includes(failure?.code) && !ambiguous.current) {
        saveDraft(key, null); pending.current = null; setLocked(false)
        setError(failure.code === '42501' ? 'Receipt not saved. Player accounts may be paused, or this player is no longer eligible. Refresh the account before trying again.' : 'Receipt not saved. Check the amount, date and method before trying again.')
      } else {
        ambiguous.current = true
        setError(failure?.code === '42501'
          ? 'Player accounts may be paused. This earlier receipt still needs confirmation. Keep it and retry when accounts are available.'
          : "Couldn't confirm the receipt. Retry the same receipt to check and save it once.")
      }
    }
    finally { saving.current = false; setBusy(false) }
  }
  return <form className="receipt-form mt-3 col gap-3" onSubmit={save}>
    <h3>Record receipt</h3>
    <p className="muted">Record money already received by the club.</p>
    {draft && <p role="status">An earlier receipt still needs confirmation. Retry to check and save it once.</p>}
    <label className="field">Amount (£)<input className="input mono" inputMode="decimal" required value={amount} disabled={locked} onChange={e => setAmount(e.target.value)} /></label>
    <label className="field">Received on<input className="input" type="date" required max={todayISO()} value={receivedOn} disabled={locked} onChange={e => setReceivedOn(e.target.value)} /></label>
    <label className="field">Method<select className="select" value={method} disabled={locked} onChange={e => setMethod(e.target.value)}><option value="cash">Cash</option><option value="bank">Bank transfer</option></select></label>
    <label className="field">{method === 'bank' ? 'Bank reference (optional)' : 'Reference (optional)'}<input className="input" maxLength={200} value={reference} disabled={locked} onChange={e => setReference(e.target.value)} /></label>
    <label className="field">Description (optional)<input className="input" maxLength={500} value={description} disabled={locked} onChange={e => setDescription(e.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    <button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy ? 'Saving…' : locked ? 'Retry receipt' : 'Save receipt'}</button>
    {!locked && <button className="btn btn-ghost btn-block" type="button" onClick={onCancel}>Cancel</button>}
  </form>
}
