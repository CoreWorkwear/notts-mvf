import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { todayISO } from '../lib/format'

const operations = {
  fine: ['Add a fine', 'record_account_fine'],
  adjustment: ['Adjust balance', 'record_account_adjustment'],
  reversal: ['Reverse a transaction', 'reverse_account_entry'],
  correct: ['Move a receipt to the right player', 'correct_manual_receipt_player'],
}
const drafts = new Map()
const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })

function keyFor(actorId, profileId) {
  return `mvf:account-change:${actorId}:${profileId}`
}

export function pendingAccountChange(actorId, profileId) {
  const key = keyFor(actorId, profileId)
  if (drafts.has(key)) return drafts.get(key)
  try {
    const value = JSON.parse(sessionStorage.getItem(key))
    if (Object.hasOwn(operations, value?.operation) && value?.args?.p_request_id) return value
  } catch { /* In-memory drafts still survive closing the sheet. */ }
  return null
}

function keepDraft(actorId, profileId, draft) {
  const key = keyFor(actorId, profileId)
  if (draft) drafts.set(key, draft)
  else drafts.delete(key)
  try {
    if (draft) sessionStorage.setItem(key, JSON.stringify(draft))
    else sessionStorage.removeItem(key)
  } catch { /* Keep the in-memory recovery path. */ }
}

function entryLabel(entry) {
  return `${entry.occurred_on} · ${entry.description} · ${gbp.format(entry.amount_pence / 100)}`
}

export default function ManagerAccountChange({ profileId, actorId, entries, players, onClose, onSaved }) {
  const [pending, setPending] = useState(() => pendingAccountChange(actorId, profileId))
  const [operation, setOperation] = useState(pending?.operation ?? 'fine')
  const [amount, setAmount] = useState('')
  const [direction, setDirection] = useState('credit')
  const [reason, setReason] = useState('')
  const [date, setDate] = useState(todayISO)
  const [entryId, setEntryId] = useState('')
  const [target, setTarget] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)

  const usesEntry = operation === 'reversal' || operation === 'correct'
  const reversed = new Set(entries.filter(entry => entry.kind === 'reversal').map(entry => entry.linked_entry_id))
  const choices = entries.filter(entry => {
    if (reversed.has(entry.id)) return false
    if (entry.kind === 'receipt') return ['bank', 'cash'].includes(entry.source)
    return operation === 'reversal' && ['charge', 'adjustment'].includes(entry.kind)
  })

  function selectOperation(next) {
    setOperation(next)
    setEntryId('')
    setError('')
  }

  function makeDraft() {
    const common = { p_request_id: crypto.randomUUID(), p_reason: reason.trim(), p_occurred_on: date }
    if (!common.p_reason || !date) return null
    if (usesEntry) {
      if (!entryId || (operation === 'correct' && !target)) return null
      const args = { ...common, p_entry_id: entryId }
      if (operation === 'correct') args.p_profile_id = target
      return { operation, args }
    }
    const pence = Math.round(Number(amount) * 100)
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount) || pence <= 0 || pence > 2147483647) return null
    const sign = operation === 'adjustment' && direction === 'debit' ? -1 : 1
    return { operation, args: { ...common, p_profile_id: profileId, p_amount_pence: sign * pence } }
  }

  async function save(event) {
    event.preventDefault()
    if (saving.current) return
    const draft = pending ?? makeDraft()
    if (!draft) {
      setError('Complete the transaction, amount, date and reason fields shown above.')
      return
    }
    saving.current = true
    keepDraft(actorId, profileId, draft)
    setPending(draft)
    setBusy(true)
    setError('')
    try {
      const { error } = await supabase.rpc(operations[draft.operation][1], draft.args)
      if (error) throw error
      keepDraft(actorId, profileId, null)
      onSaved()
    } catch (failure) {
      const refused = ['22023', '42501', '23505', 'P0002'].includes(failure?.code)
      if (refused && !pending) {
        keepDraft(actorId, profileId, null)
        setPending(null)
        setError(failure.code === '42501' ? 'Club accounts are unavailable or you cannot make this correction.'
          : 'The change was refused. Check the transaction and try again.')
      } else {
        setError("Couldn't confirm this change. Retry the same request to check and save it once.")
      }
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  return <form className="receipt-form mt-3 col gap-3" onSubmit={save}>
    <h3>Fine or correction</h3>
    {pending ? <div role="status">
      <p>{operations[pending.operation][0]}</p>
      <p>{pending.args.p_reason}</p>
    </div> : <>
      <label className="field">Action<select className="select" aria-label="Action" value={operation} onChange={event => selectOperation(event.target.value)}>
        {Object.entries(operations).map(([value, [label]]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      {usesEntry ? <label className="field">Original transaction<select className="select" aria-label="Original transaction" value={entryId} onChange={event => setEntryId(event.target.value)} required>
        <option value="">{choices.length ? 'Choose a transaction' : 'No eligible transactions'}</option>
        {choices.map(entry => <option key={entry.id} value={entry.id}>{entryLabel(entry)}</option>)}
      </select></label> : <label className="field">Amount (£)
        <input className="input mono" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} required />
      </label>}
      {operation === 'adjustment' && <label className="field">Direction<select className="select" aria-label="Direction" value={direction} onChange={event => setDirection(event.target.value)}>
        <option value="credit">Increase balance</option><option value="debit">Decrease balance</option>
      </select></label>}
      {operation === 'correct' && <label className="field">Correct player<select className="select" aria-label="Correct player" value={target} onChange={event => setTarget(event.target.value)} required>
        <option value="">Choose a player</option>
        {players.filter(player => player.id !== profileId && player.active && player.approved && player.is_player).map(player => <option key={player.id} value={player.id}>{player.first_name} {player.last_name}</option>)}
      </select></label>}
      <label className="field">Date<input className="input" type="date" value={date} max={todayISO()} onChange={event => setDate(event.target.value)} required /></label>
      <label className="field">Reason<textarea className="input" maxLength={500} value={reason} onChange={event => setReason(event.target.value)} required /></label>
      {operation === 'correct' && <p>The original receipt is reversed and the same money is credited to the selected player.</p>}
    </>}
    {error && <p role="alert">{error}</p>}
    <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : pending ? 'Retry change' : 'Save change'}</button>
    <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>{pending ? 'Close' : 'Cancel'}</button>
  </form>
}
