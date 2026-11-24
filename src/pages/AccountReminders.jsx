import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePaymentsRelease } from '../hooks/usePaymentsRelease'
import { supabase } from '../lib/supabase'

const pendingRequests = new Map()
function readPending(key) {
  if (pendingRequests.has(key)) return pendingRequests.get(key)
  try {
    const value = JSON.parse(sessionStorage.getItem(key))
    if (/^[\da-f-]{36}$/i.test(value?.request_id)) return value
  } catch { /* The in-memory recovery path remains available. */ }
  return null
}
function writePending(key, request) {
  if (request) pendingRequests.set(key, request)
  else pendingRequests.delete(key)
  try {
    if (request) sessionStorage.setItem(key, JSON.stringify(request))
    else sessionStorage.removeItem(key)
  } catch { /* Keep the in-memory request stable. */ }
}

export default function AccountReminders() {
  const { user, profile, isAdmin } = useAuth()
  const release = usePaymentsRelease(user?.id, profile?.club_id)
  return <div className="page">
    <Link className="btn btn-ghost" to="/manage">Back to Club admin</Link>
    <h1 className="display mt-3" style={{ fontSize: 'var(--type-display)' }}>Account reminders</h1>
    {!isAdmin ? <p className="mt-3" role="alert">Only a club manager can send account reminders.</p> : release.error ? <div className="mt-3" role="alert"><p>Couldn't check whether player accounts are available.</p><button className="btn btn-ghost mt-2" onClick={release.retry}>Try again</button></div> : release.loading && !release.enabled ? <p className="mt-3" role="status">Loading player accounts…</p> : !release.enabled ? <p className="mt-3" role="status">Player accounts are currently unavailable.</p> : <ReminderControls key={`${user?.id}:${profile?.club_id}`} identity={`${user?.id}:${profile?.club_id}`} />}
  </div>
}

function ReminderControls({ identity }) {
  const storageKey = `mvf:account-reminder-send:${identity}`
  const [pending, setPending] = useState(() => readPending(storageKey))
  const request = useRef(pending)
  const inFlight = useRef(false)
  const [targets, setTargets] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [shareText, setShareText] = useState('')
  const [shareError, setShareError] = useState('')
  useEffect(() => {
    let active = true
    setTargets(null); setLoadError(false); setShareText(''); setShareError('')
    Promise.resolve().then(() => supabase.rpc('get_account_reminder_targets')).then(({ data, error }) => {
      if (error || !Array.isArray(data) || !data.every(row => typeof row.profile_id === 'string' && typeof row.first_name === 'string' && Number.isSafeInteger(row.balance_pence) && row.balance_pence < 0)) throw error ?? new Error('Invalid reminder targets')
      if (active) setTargets(data)
    }).catch(() => { if (active) setLoadError(true) })
    return () => { active = false }
  }, [attempt])
  async function send() {
    if (inFlight.current || (!request.current && !targets?.length)) return
    request.current ??= { request_id: crypto.randomUUID() }
    writePending(storageKey, request.current); setPending(request.current)
    inFlight.current = true; setBusy(true); setError(''); setResult(null)
    try {
      const { data, error } = await supabase.functions.invoke('send-account-reminders', { body: request.current })
      if (error || !Number.isSafeInteger(data?.targeted) || data.targeted < 0 || !Number.isSafeInteger(data.push_sent) || data.push_sent < 0 || typeof data.push_status !== 'string') throw error ?? new Error('Reminder send not confirmed')
      setResult(data); writePending(storageKey, null); request.current = null; setPending(null)
      setAttempt(value => value + 1)
    } catch { setError("Couldn't confirm the reminders. Retry the same send to check and create each reminder once.") }
    finally { inFlight.current = false; setBusy(false) }
  }
  async function share() {
    setShareError('')
    try {
      if (navigator.share) await navigator.share({ text: shareText })
      else window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener,noreferrer')
    } catch (failure) {
      if (failure?.name !== 'AbortError') setShareError("Couldn't open sharing. Copy the prepared message and share it yourself.")
    }
  }
  const owe = targets?.length > 0
  return <>
    <p className="muted mt-3">Review players in arrears. Balances are checked again when reminders are sent. Each reminder opens the player's own current account.</p>
    {loadError ? <div className="mt-3" role="alert"><p>Couldn't load players in arrears.</p><button className="btn btn-ghost mt-2" onClick={() => setAttempt(value => value + 1)}>Try again</button></div> : !targets ? <p className="mt-3" role="status">Loading players in arrears…</p> : <section className="mt-5" aria-labelledby="account-reminder-targets">
      <h2 id="account-reminder-targets" style={{ fontSize: 'var(--type-lg)' }}>Players in arrears</h2>
      {owe ? <ul className="col gap-2 mt-3" style={{ listStyle: 'none', padding: 0 }}>{targets.map(player => <li className="row spread" key={player.profile_id}><span>{player.first_name}</span><span className="mono">{new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(-player.balance_pence / 100)} owed</span></li>)}</ul> : <p className="muted mt-2">No players are in arrears.</p>}
    </section>}
    {pending && <p role="status" className="mt-3">An earlier send still needs confirmation. Retrying reuses that send.</p>}
    <button className="btn btn-primary btn-block mt-3" disabled={busy || !!result || (!pending && !owe)} onClick={send}>{busy ? 'Sending…' : pending ? 'Retry account reminders' : 'Send account reminders'}</button>
    {error && <p role="alert" className="field-error mt-2">{error}</p>}
    {result && <div role="status" className="mt-3">
      <p>{result.targeted === 0 ? 'No players were in arrears when reminders were sent.' : `In-app reminders created for ${result.targeted} ${result.targeted === 1 ? 'player' : 'players'}.`}</p>
      <p>Push notifications sent: {result.push_sent}. {['sent', 'complete', 'delivered'].includes(result.push_status) ? '' : 'Other push delivery is not confirmed. In-app reminders remain available.'}</p>
    </div>}
    <button className="btn btn-ghost btn-block mt-3" disabled={busy} onClick={() => { setResult(null); setAttempt(value => value + 1) }}>Refresh players in arrears</button>
    <button className="btn btn-ghost btn-block mt-3" disabled={!owe || busy} onClick={() => { setShareText(`${targets.map(player => player.first_name).join(', ')} — please check your current subs account: ${new URL('/you', window.location.origin).href}`); setShareError('') }}>WhatsApp Share</button>
    {shareText && <div className="col gap-3 mt-3"><label className="field">WhatsApp message<textarea className="input" readOnly rows={5} value={shareText} /></label><p className="muted">The same link opens each signed-in player's own account. Check the message and recipients before sending.</p><button className="btn btn-ghost btn-block" onClick={share}>Share message</button>{shareError && <p role="alert">{shareError}</p>}</div>}
  </>
}
