import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import './SavedCards.css'

const brands = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', discover: 'Discover', diners: 'Diners Club', jcb: 'JCB', unionpay: 'UnionPay', eftpos_au: 'eftpos' }
const cardLabel = card => `${brands[card.brand] || 'Card'} ending ${card.last4}`
async function request(body) {
  const { data, error } = await supabase.functions.invoke('stripe-saved-cards', { body })
  if (error) throw error
  return data
}

export default function SavedCards({ profileId, ready = false }) {
  const { user, profile } = useAuth()
  const ownerKey = `${user?.id ?? ''}:${profile?.id ?? ''}:${profile?.club_id ?? ''}:${profileId}`
  const allowed = ready && !!user?.id && user.id === profileId && profile?.id === profileId && profile.is_player && profile.approved && profile.active
  const currentOwner = useRef(ownerKey)
  currentOwner.current = allowed ? ownerKey : null
  const [open, setOpen] = useState(false)
  const [load, setLoad] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [confirming, setConfirming] = useState(null)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const inFlight = useRef(false)
  useEffect(() => {
    setLoad(null); setConfirming(null); setError(''); setNotice(''); setRemoving(false)
    inFlight.current = false
  }, [ownerKey, allowed])
  useEffect(() => {
    if (!allowed || !open) return
    let active = true
    setLoad({ ownerKey, loading: true })
    request({ action: 'list' }).then(data => {
      if (!Array.isArray(data?.cards) || !data.cards.every(card => typeof card.id === 'string' && card.id.length > 0 && typeof card.brand === 'string' && /^\d{4}$/.test(card.last4))) throw new Error('Invalid saved cards')
      if (active) setLoad({ ownerKey, cards: data.cards.map(({ id, brand, last4 }) => ({ id, brand, last4 })) })
    }).catch(() => { if (active) setLoad({ ownerKey, error: true }) })
    return () => { active = false }
  }, [allowed, open, ownerKey, attempt])
  async function remove() {
    if (inFlight.current || !allowed || !confirming || confirming.ownerKey !== ownerKey) return
    const owner = ownerKey
    const card = confirming.card
    inFlight.current = true; setRemoving(true); setError(''); setNotice('')
    try {
      const data = await request({ action: 'remove', id: card.id, confirmed: true })
      if (data?.removed !== true) throw new Error('Removal not confirmed')
      if (currentOwner.current !== owner) return
      setConfirming(null); setNotice(`${cardLabel(card)} removed.`); setAttempt(value => value + 1)
    } catch {
      if (currentOwner.current === owner) setError("Couldn't confirm card removal. Retry removing the same card or refresh the list to check it.")
    } finally {
      if (currentOwner.current === owner) { inFlight.current = false; setRemoving(false) }
    }
  }
  if (!allowed) return null
  const current = load?.ownerKey === ownerKey ? load : null
  const confirmation = confirming?.ownerKey === ownerKey ? confirming.card : null
  return <details className="saved-cards mt-3" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Saved cards</summary>
    {open && <div className="col gap-3 mt-2">
      <p className="muted">Saved cards are available in Stripe Checkout. You authorise each payment there.</p>
      {!current || current.loading ? <p role="status">Loading saved cards…</p> : current.error ? <div role="alert"><p>Couldn't load saved cards.</p><button className="btn btn-ghost btn-block mt-2" onClick={() => setAttempt(value => value + 1)}>Retry saved cards</button></div> : current.cards.length === 0 ? <p>No saved cards.</p> : <ul className="saved-card-list">{current.cards.map(card => <li key={card.id}>
        <span>{cardLabel(card)}</span>
        <button type="button" className="btn btn-ghost" disabled={removing} aria-label={`Remove ${cardLabel(card)}`} onClick={() => { setConfirming({ ownerKey, card }); setError(''); setNotice('') }}>Remove</button>
      </li>)}</ul>}
      {confirmation && <div role="group" aria-label="Confirm card removal" className="col gap-2">
        <p>Remove {cardLabel(confirmation)}? It will no longer be offered in Checkout.</p>
        <button type="button" className="btn btn-primary btn-block" disabled={removing} onClick={remove}>{removing ? 'Removing…' : 'Remove card'}</button>
        <button type="button" className="btn btn-ghost btn-block" disabled={removing} onClick={() => { setConfirming(null); setError('') }}>Keep card</button>
      </div>}
      {current && error && <p className="field-error" role="alert">{error}</p>}
      {current && notice && <p role="status">{notice}</p>}
      <button type="button" className="btn btn-ghost btn-block" disabled={removing} onClick={() => { setConfirming(null); setError(''); setNotice(''); setAttempt(value => value + 1) }}>Refresh saved cards</button>
    </div>}
  </details>
}
