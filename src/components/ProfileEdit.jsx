import PreferredPosition from './PreferredPosition'
import { Fragment, useEffect, useId, useRef, useState } from 'react'
import Sheet from './Sheet'
import Toast from './Toast'
import { supabase } from '../lib/supabase'
import { POSITIONS } from '../lib/constants'
import { validatePlayer } from '../lib/players'

// A player edits their OWN details. Everything personal is editable — name, phone,
// date of birth, emergency contact, positions, preferred — but NOT email (the
// account hangs off it; the manager changes that) and NOT role/team/approval
// (admin-only, and the DB's protect-profile-columns trigger enforces that anyway).
export default function ProfileEdit({ open, onClose, profile, onSaved, mode = 'sheet' }) {
  const detailsOnly = mode === 'details'
  const id = useId()
  const Wrapper = detailsOnly ? Fragment : Sheet
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [dob, setDob] = useState('')
  const [ecName, setEcName] = useState('')
  const [ecPhone, setEcPhone] = useState('')
  const [positions, setPositions] = useState([])
  const [preferred, setPreferred] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [invalid, setInvalid] = useState(new Set())
  const clearInvalid = (k) => setInvalid((s) => { if (!s.has(k)) return s; const n = new Set(s); n.delete(k); return n })
  const formRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setError(null); setInvalid(new Set())
    setFirstName(profile?.first_name ?? '')
    setLastName(profile?.last_name ?? '')
    setPhone(profile?.phone ?? '')
    setDob(profile?.dob ?? '')
    setEcName(profile?.ec_name ?? '')
    setEcPhone(profile?.ec_phone ?? '')
    setPositions(profile?.positions ?? [])
    setPreferred(profile?.preferred ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (invalid.size === 0) return
    const el = formRef.current?.querySelector('[aria-invalid="true"]')
    if (el) { el.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); el.focus?.({ preventScroll: true }) }
  }, [invalid])

  const toggle = (v) => setPositions((arr) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]))

  async function onSubmit(e) {
    e.preventDefault()
    // Reuse the shared validation; email is the account's existing one (not edited here).
    const v = validatePlayer({ first_name: firstName, last_name: lastName, email: profile.email, phone })
    if (v) {
      const bad = new Set()
      if (!firstName.trim()) bad.add('first')
      if (!lastName.trim()) bad.add('last')
      if (!phone.trim()) bad.add('phone')
      setInvalid(bad); setError(v); return
    }
    setError(null); setBusy(true)
    try {
      // Squad-visible fields on profiles; the personal ones on profile_private
      // (self-or-admin RLS — the row always exists, created at signup).
      const { error: upErr } = await supabase.from('profiles').update({
        ...(!detailsOnly ? { first_name: firstName.trim(), last_name: lastName.trim() } : {}),
        positions, preferred: preferred || null,
      }).eq('id', profile.id)
      if (upErr) throw upErr
      const { error: pvErr } = await supabase.from('profile_private').update({
        phone: phone.trim(), dob: dob || null,
        ec_name: ecName.trim() || null, ec_phone: ecPhone.trim() || null,
      }).eq('profile_id', profile.id)
      if (pvErr) throw pvErr
      onSaved?.(); onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Wrapper {...(detailsOnly ? {} : { open, onClose })}>
      <Toast message={error} tone="error" onDismiss={() => setError(null)} />
      {!detailsOnly && <h2 className="display" style={{ fontSize: 'var(--type-title)' }}>Edit your details</h2>}

      <form className="col gap-3 mt-4" onSubmit={onSubmit} ref={formRef}>
        {!detailsOnly && <div className="row gap-2">
          <div className="field grow"><label className="label">First name</label>
            <input className="input" value={firstName} aria-invalid={invalid.has('first') || undefined}
              onChange={(e) => { setFirstName(e.target.value); clearInvalid('first') }} /></div>
          <div className="field grow"><label className="label">Surname</label>
            <input className="input" value={lastName} aria-invalid={invalid.has('last') || undefined}
              onChange={(e) => { setLastName(e.target.value); clearInvalid('last') }} /></div>
        </div>}

        {detailsOnly && <label className="field">Sign-in email<input className="input" type="email" readOnly value={profile.email ?? ''} /></label>}

        <div className="field"><label className="label" htmlFor={`${id}-phone`}>Phone</label>
          <input id={`${id}-phone`} className="input" type="tel" autoComplete="tel" value={phone} aria-invalid={invalid.has('phone') || undefined}
            onChange={(e) => { setPhone(e.target.value); clearInvalid('phone') }} /></div>

        <div className="row gap-2">
          <div className="field grow"><label className="label" htmlFor={`${id}-dob`}>Date of birth</label>
            <input id={`${id}-dob`} className="input" type="date" value={dob ?? ''} onChange={(e) => setDob(e.target.value)} /></div>
        </div>
        <PreferredPosition value={preferred} onChange={setPreferred} />

        <div className="field"><label className="label">Positions you play</label>
          <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
            {POSITIONS.map((p) => (
              <button type="button" key={p} className="chip" aria-pressed={positions.includes(p)} onClick={() => toggle(p)}>{p}</button>
            ))}
          </div></div>

        <div className="row gap-2">
          <div className="field grow"><label className="label" htmlFor={`${id}-ec-name`}>Emergency contact</label>
            <input id={`${id}-ec-name`} className="input" value={ecName} onChange={(e) => setEcName(e.target.value)} /></div>
          <div className="field grow"><label className="label" htmlFor={`${id}-ec-phone`}>Emergency phone</label>
            <input id={`${id}-ec-phone`} className="input" type="tel" value={ecPhone} onChange={(e) => setEcPhone(e.target.value)} /></div>
        </div>

        <p className="dim" style={{ fontSize: 'var(--type-caption)' }}>Only a manager can change your sign-in email.</p>

        <div className={detailsOnly ? undefined : 'sheet-actions'}>
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </Wrapper>
  )
}
