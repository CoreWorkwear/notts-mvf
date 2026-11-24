import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePlayers } from '../hooks/usePlayers'
import { usePaymentsRelease } from '../hooks/usePaymentsRelease'
import { parseDate, todayISO } from '../lib/format'
import { supabase } from '../lib/supabase'
import './OpeningBalances.css'

const gbp = pence => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100)
const dateLabel = value => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(parseDate(value))
const openingLabel = pence => pence === 0 ? 'Settled' : `${gbp(Math.abs(pence))} ${pence > 0 ? 'in credit' : 'in arrears'}`
const memory = new Map()
function pendingRead(key) {
  if (memory.has(key)) return memory.get(key)
  try {
    const saved = JSON.parse(sessionStorage.getItem(key))
    if (saved?.payload?.p_request_id && Number.isSafeInteger(saved.payload.p_amount_pence)) return saved
  } catch { /* The memory copy still supports closing and reopening this page. */ }
  return null
}
function pendingWrite(key, value) {
  if (value) memory.set(key, value)
  else memory.delete(key)
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value))
    else sessionStorage.removeItem(key)
  } catch { /* Session storage can be unavailable. Keep the memory copy. */ }
}

export default function OpeningBalances() {
  const { user, profile, isAdmin } = useAuth()
  const release = usePaymentsRelease(user?.id, profile?.club_id)
  return <div className="page opening-balances">
    <Link className="btn btn-ghost" to="/manage">Back to Club admin</Link>
    <h1 className="display mt-3">Opening balances</h1>
    {!isAdmin ? <p role="alert" className="mt-3">Only a club manager can enter opening balances.</p> : release.error ? <div role="alert" className="mt-3"><p>Couldn't check whether player accounts are available.</p><button className="btn btn-ghost mt-2" onClick={release.retry}>Try again</button></div> : release.loading && !release.enabled ? <p role="status" className="mt-3">Loading player accounts…</p> : !release.enabled ? <p role="status" className="mt-3">Player accounts are currently unavailable.</p> : <OpeningManager key={`${user?.id}:${profile?.club_id}`} actorId={user?.id} clubId={profile?.club_id} />}
  </div>
}

function OpeningManager({ actorId, clubId }) {
  const formId = useId()
  const { players, loading: playersLoading, error: playersError, refetch: retryPlayers } = usePlayers()
  const storageKey = `mvf:opening:${actorId}:${clubId}`
  const [recovered] = useState(() => pendingRead(storageKey))
  const request = useRef(recovered)
  const ambiguous = useRef(!!recovered)
  const inFlight = useRef(false)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [playerId, setPlayerId] = useState(recovered?.payload.p_profile_id ?? '')
  const [direction, setDirection] = useState(recovered ? (recovered.payload.p_amount_pence > 0 ? 'credit' : recovered.payload.p_amount_pence < 0 ? 'arrears' : 'settled') : 'credit')
  const [amount, setAmount] = useState(recovered ? (Math.abs(recovered.payload.p_amount_pence) / 100).toFixed(2) : '')
  const [effectiveOn, setEffectiveOn] = useState(recovered?.payload.p_effective_on ?? todayISO())
  const [locked, setLocked] = useState(!!recovered)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true); setLoadError(false); setSummary(null)
    Promise.resolve().then(() => supabase.rpc('get_account_opening_summary')).then(({ data, error }) => {
      if (error || !Array.isArray(data?.entries) || !Number.isSafeInteger(data.opening_credit_pence) || !Number.isSafeInteger(data.opening_arrears_pence) || !Number.isSafeInteger(data.net_opening_pence)) throw error ?? new Error('Invalid opening totals')
      if (active) { setSummary(data); if (data.effective_on && !request.current) setEffectiveOn(data.effective_on) }
    }).catch(() => { if (active) setLoadError(true) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [attempt])

  const eligible = players.filter(player => player.active && player.approved && player.is_player)
  const recorded = new Set(summary?.entries.map(entry => entry.profile_id) ?? [])
  const selectable = eligible.filter(player => !recorded.has(player.id) || (locked && player.id === playerId))
  async function save(event) {
    event.preventDefault()
    if (inFlight.current || !summary || playersError || playersLoading) return
    if (!request.current) {
      const player = selectable.find(person => person.id === playerId)
      const pence = Math.round(Number(amount) * 100)
      if (!player || !effectiveOn || (direction !== 'settled' && (!/^\d+(?:\.\d{1,2})?$/.test(amount) || pence <= 0 || pence > 2147483647))) {
        setSaveError('Choose a player, an effective date and an amount greater than £0 with no more than two decimal places.'); return
      }
      request.current = { payload: { p_request_id: crypto.randomUUID(), p_profile_id: playerId, p_amount_pence: direction === 'settled' ? 0 : direction === 'arrears' ? -pence : pence, p_effective_on: summary.effective_on || effectiveOn }, player_name: `${player.first_name} ${player.last_name}` }
      pendingWrite(storageKey, request.current); setLocked(true)
    }
    setSaveError(''); setNotice(''); setSaving(true); inFlight.current = true
    try {
      const { data, error } = await supabase.rpc('record_account_opening', request.current.payload)
      if (error || typeof data !== 'string') throw error ?? new Error('No opening confirmation')
      const saved = request.current
      pendingWrite(storageKey, null); request.current = null; ambiguous.current = false
      setLocked(false); setPlayerId(''); setAmount('')
      setNotice(`Opening balance saved for ${saved.player_name}: ${openingLabel(saved.payload.p_amount_pence)}.`)
      setAttempt(value => value + 1)
    } catch (failure) {
      if (!ambiguous.current && ['22023', '42501', '23505'].includes(failure?.code)) {
        pendingWrite(storageKey, null); request.current = null; setLocked(false)
        setSaveError('Opening balance not saved. Check that the player has no opening balance already and that the club date and account access are still current. Reload the opening totals before trying again.')
      } else {
        ambiguous.current = true
        setSaveError(failure?.code === '42501' ? 'Player accounts may be paused. This opening balance still needs confirmation. Keep it and retry when accounts are available.' : "Couldn't confirm the opening balance. Retry the same opening balance to check and save it once.")
      }
    } finally { setSaving(false); inFlight.current = false }
  }

  return <>
    <p className="muted mt-3">Bring forward the club's existing figures. Opening balances are separate from receipts and activity charges.</p>
    {notice && <p role="status" className="mt-3">{notice}</p>}
    {loading ? <p className="mt-3" role="status">Loading opening totals…</p> : loadError ? <div className="mt-3" role="alert"><p>Couldn't load opening balances. Opening totals are unavailable.</p><button className="btn btn-ghost mt-2" onClick={() => setAttempt(value => value + 1)}>Try again</button></div> : summary && <>
      <section className="mt-5" aria-labelledby="opening-totals"><h2 id="opening-totals">Opening totals</h2>
        {summary.effective_on && <p className="mt-2">Club effective date: <span className="mono">{dateLabel(summary.effective_on)}</span></p>}
        <dl className="opening-total-list mt-3"><div><dt>Opening credit</dt><dd className="mono">{gbp(summary.opening_credit_pence)}</dd></div><div><dt>Opening arrears</dt><dd className="mono">{gbp(summary.opening_arrears_pence)}</dd></div><div><dt>Net opening balance</dt><dd className="mono">{gbp(summary.net_opening_pence)}</dd></div></dl>
        <p className="muted mt-2">{summary.account_count} accounts · {summary.credit_count} in credit · {summary.arrears_count} in arrears · {summary.settled_count} settled</p>
      </section>
      <section className="mt-5" aria-labelledby="opening-entry"><h2 id="opening-entry">Enter an opening balance</h2>
        {playersError ? <div className="mt-2" role="alert"><p>Couldn't load the players. Existing opening records have been kept.</p><button className="btn btn-ghost mt-2" onClick={retryPlayers}>Retry players</button></div> : playersLoading ? <p role="status" className="mt-2">Loading players…</p> : <form className="col gap-3 mt-3" onSubmit={save}>
          {recovered && locked && <p role="status">An earlier opening balance still needs confirmation. Retry its original details.</p>}
          <div className="field"><label htmlFor={`${formId}-player`}>Player</label><select id={`${formId}-player`} className="select" required value={playerId} disabled={locked} onChange={event => setPlayerId(event.target.value)}><option value="">Choose a player</option>{selectable.map(player => <option key={player.id} value={player.id}>{player.first_name} {player.last_name}</option>)}{locked && !selectable.some(player => player.id === playerId) && <option value={playerId}>{request.current?.player_name || 'Previously selected player'}</option>}</select></div>
          <div className="field"><label htmlFor={`${formId}-direction`}>Opening balance</label><select id={`${formId}-direction`} className="select" value={direction} disabled={locked} onChange={event => setDirection(event.target.value)}><option value="credit">Credit</option><option value="arrears">Arrears</option><option value="settled">Settled</option></select></div>
          {direction !== 'settled' && <label className="field">Amount (£)<input className="input mono" inputMode="decimal" required value={amount} disabled={locked} onChange={event => setAmount(event.target.value)} /></label>}
          {summary.effective_on ? <p>Effective date: <span className="mono">{dateLabel(summary.effective_on)}</span>. The club date is fixed.</p> : <label className="field">Effective date<input className="input" type="date" required value={effectiveOn} disabled={locked} onChange={event => setEffectiveOn(event.target.value)} /></label>}
          {locked && summary.effective_on && request.current?.payload.p_effective_on !== summary.effective_on && <p className="muted">The earlier request uses {dateLabel(request.current.payload.p_effective_on)}. Its details must stay unchanged until confirmed.</p>}
          {!summary.effective_on && <p className="muted">The first saved opening balance fixes this date for the club.</p>}
          {saveError && <p role="alert" className="field-error">{saveError}</p>}
          <button className="btn btn-primary btn-block" type="submit" disabled={saving || (!locked && selectable.length === 0)}>{saving ? 'Saving…' : locked ? 'Retry opening balance' : 'Save opening balance'}</button>
        </form>}
        <button type="button" className="btn btn-ghost btn-block mt-3" disabled={saving} onClick={() => setAttempt(value => value + 1)}>Reload opening totals</button>
      </section>
      <section className="mt-5" aria-labelledby="opening-records"><h2 id="opening-records">Opening records</h2>
        {summary.entries.length === 0 ? <p className="muted mt-2">No opening balances recorded yet.</p> : <ul className="opening-record-list mt-2">{summary.entries.map(entry => <li key={entry.id}><strong>{entry.player_name}</strong><span className="mono">{openingLabel(entry.amount_pence)}</span><p className="muted">Opening balance · <time dateTime={entry.effective_on}>{dateLabel(entry.effective_on)}</time></p></li>)}</ul>}
      </section>
    </>}
  </>
}
