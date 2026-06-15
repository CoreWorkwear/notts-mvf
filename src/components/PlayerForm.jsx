import { useEffect, useRef, useState } from 'react'
import Sheet from './Sheet'
import Toast from './Toast'
import ImageUpload from './ImageUpload'
import { supabase, makeSignupClient } from '../lib/supabase'
import { POSITIONS } from '../lib/constants'
import { validatePlayer, diffMemberships, isSelf } from '../lib/players'

// Admin add/edit of a squad member. Add creates the login via a throwaway
// signUp client (trigger builds the profile, forced player/not-eligible);
// edit updates any field + role/eligibility/teams/active. A player can't demote
// or deactivate themselves (DB-enforced; locked here too). Password is reset
// (a link emailed to the player), never viewed.
export default function PlayerForm({ open, onClose, onSaved, player, teams, currentUserId }) {
  const adding = !player
  const self = isSelf(player, currentUserId)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [dob, setDob] = useState('')
  const [ecName, setEcName] = useState('')
  const [ecPhone, setEcPhone] = useState('')
  const [positions, setPositions] = useState([])
  const [preferred, setPreferred] = useState('')
  const [teamKeys, setTeamKeys] = useState([])
  const [xlEligible, setXlEligible] = useState(false)
  const [role, setRole] = useState('player')
  const [active, setActive] = useState(true)
  const [isPlayer, setIsPlayer] = useState(true)
  const [approved, setApproved] = useState(true)
  const [password, setPassword] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [invalid, setInvalid] = useState(new Set())
  const clearInvalid = (k) => setInvalid((s) => { if (!s.has(k)) return s; const n = new Set(s); n.delete(k); return n })
  const formRef = useRef(null)

  // On a failed save, jump to (and focus) the first flagged field.
  useEffect(() => {
    if (invalid.size === 0) return
    const el = formRef.current?.querySelector('[aria-invalid="true"]')
    if (el) { el.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); el.focus?.({ preventScroll: true }) }
  }, [invalid])

  useEffect(() => {
    if (!open) return
    setError(null); setNotice(null); setPassword(''); setInvalid(new Set())
    setFirstName(player?.first_name ?? '')
    setLastName(player?.last_name ?? '')
    setEmail(player?.email ?? '')
    setPhone(player?.phone ?? '')
    setDob(player?.dob ?? '')
    setEcName(player?.ec_name ?? '')
    setEcPhone(player?.ec_phone ?? '')
    setPositions(player?.positions ?? [])
    setPreferred(player?.preferred ?? '')
    setTeamKeys(player?.teamKeys ?? [])
    setXlEligible(player?.xl_eligible ?? false)
    setRole(player?.role ?? 'player')
    setActive(player?.active ?? true)
    setIsPlayer(player?.is_player !== false)
    setApproved(player?.approved ?? true) // manager-added players are signed off by default
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const toggle = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

  async function resetPassword() {
    if (!confirm(`Send ${firstName || 'this player'} a password-reset link to ${email}?`)) return
    setBusy(true); setError(null); setNotice(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
    setBusy(false)
    if (error) setError(error.message)
    else setNotice('Reset link sent to the player.')
  }

  async function onSubmit(e) {
    e.preventDefault()
    const v = validatePlayer({ first_name: firstName, last_name: lastName, email, phone }, { needPassword: adding, password })
    if (v) {
      const bad = new Set()
      if (!firstName.trim()) bad.add('first')
      if (!lastName.trim()) bad.add('last')
      if (!email.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) bad.add('email')
      if (!phone.trim()) bad.add('phone')
      if (adding && (!password || password.length < 6)) bad.add('password')
      setInvalid(bad)
      setError(v)
      return
    }
    setError(null); setBusy(true)
    try {
      if (adding) {
        const meta = {
          first_name: firstName.trim(), last_name: lastName.trim(), phone: phone.trim(),
          dob: dob || null, positions, preferred: preferred || null, teams: teamKeys,
          is_player: isPlayer,
        }
        // Prefer the admin Edge Function (proper server-side create). If it's
        // not deployed yet, fall back to the throwaway signUp (which keeps the
        // admin's session intact). Either way the trigger forces player/not-eligible.
        let created = false
        try {
          const { data, error } = await supabase.functions.invoke('admin-create-player', {
            body: { email: email.trim(), password, ...meta },
          })
          created = !error && !!data?.id
        } catch { /* function not deployed — fall through */ }
        if (!created) {
          const tmp = makeSignupClient()
          const { error } = await tmp.auth.signUp({ email: email.trim(), password, options: { data: meta } })
          if (error) throw error
        }
      } else {
        // Duplicate-email guard (excluding this player).
        const { data: dupe } = await supabase.from('profiles').select('id').eq('email', email.trim()).neq('id', player.id)
        if (dupe && dupe.length) throw new Error('Another player already uses that email.')

        const { error: upErr } = await supabase.from('profiles').update({
          first_name: firstName.trim(), last_name: lastName.trim(), email: email.trim(), phone: phone.trim(),
          dob: dob || null, ec_name: ecName.trim() || null, ec_phone: ecPhone.trim() || null,
          positions, preferred: preferred || null,
          xl_eligible: xlEligible, role, active, is_player: isPlayer, approved,
        }).eq('id', player.id)
        if (upErr) throw upErr

        const { toAdd, toRemove } = diffMemberships(player.teamIds, teamKeys, teams)
        if (toRemove.length) {
          const { error } = await supabase.from('team_memberships').delete().eq('profile_id', player.id).in('team_id', toRemove)
          if (error) throw error
        }
        if (toAdd.length) {
          const { error } = await supabase.from('team_memberships').insert(toAdd.map((team_id) => ({ profile_id: player.id, team_id })))
          if (error) throw error
        }
      }
      onSaved(); onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <Toast message={error} tone="error" onDismiss={() => setError(null)} />
      <Toast message={notice} tone="success" onDismiss={() => setNotice(null)} />
      <p className="kicker"><span className="kicker-rule">{adding ? 'ADD PLAYER' : 'EDIT PLAYER'}</span></p>
      <h2 className="display mt-2" style={{ fontSize: 24 }}>{adding ? 'New player' : `${firstName} ${lastName}`}</h2>

      <form className="col gap-3 mt-4" onSubmit={onSubmit} ref={formRef}>
        <div className="row gap-2">
          <div className="field grow"><label className="label">First name</label>
            <input className="input" value={firstName} aria-invalid={invalid.has('first') || undefined}
              onChange={(e) => { setFirstName(e.target.value); clearInvalid('first') }} /></div>
          <div className="field grow"><label className="label">Surname</label>
            <input className="input" value={lastName} aria-invalid={invalid.has('last') || undefined}
              onChange={(e) => { setLastName(e.target.value); clearInvalid('last') }} /></div>
        </div>
        <div className="field"><label className="label">Email {adding ? '(their login)' : ''}</label>
          <input className="input" type="email" value={email} aria-invalid={invalid.has('email') || undefined}
            onChange={(e) => { setEmail(e.target.value); clearInvalid('email') }} /></div>
        <div className="field"><label className="label">Phone</label>
          <input className="input" value={phone} aria-invalid={invalid.has('phone') || undefined}
            onChange={(e) => { setPhone(e.target.value); clearInvalid('phone') }} /></div>

        {adding && (
          <div className="field"><label className="label">Starter password (hand this over)</label>
            <input className="input" value={password} aria-invalid={invalid.has('password') || undefined}
              onChange={(e) => { setPassword(e.target.value); clearInvalid('password') }} placeholder="min 6 characters" /></div>
        )}

        <div className="row gap-2">
          <div className="field grow"><label className="label">Date of birth</label>
            <input className="input" type="date" value={dob ?? ''} onChange={(e) => setDob(e.target.value)} /></div>
          <div className="field grow"><label className="label">Preferred position</label>
            <select className="select" value={preferred ?? ''} onChange={(e) => setPreferred(e.target.value)}>
              <option value="">—</option>
              {POSITIONS.map((p) => <option key={p}>{p}</option>)}
            </select></div>
        </div>

        {!adding && (
          <div className="row gap-2">
            <div className="field grow"><label className="label">Emergency contact</label>
              <input className="input" value={ecName} onChange={(e) => setEcName(e.target.value)} /></div>
            <div className="field grow"><label className="label">Emergency phone</label>
              <input className="input" value={ecPhone} onChange={(e) => setEcPhone(e.target.value)} /></div>
          </div>
        )}

        {!adding && (
          <div className="field">
            <label className="label">Headshot</label>
            <ImageUpload
              folder="players" shape="round" maxDim={512}
              current={player?.photo_url}
              label={player?.photo_url ? 'Replace headshot' : 'Add headshot'}
              onUploaded={async (url) => {
                const { error } = await supabase.from('profiles').update({ photo_url: url }).eq('id', player.id)
                if (error) setError(error.message)
              }}
            />
          </div>
        )}

        <div className="field"><label className="label">Positions</label>
          <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
            {POSITIONS.map((p) => (
              <button type="button" key={p} className="chip" aria-pressed={positions.includes(p)} onClick={() => toggle(positions, setPositions, p)}>{p}</button>
            ))}
          </div></div>

        <div className="field"><label className="label">Account type</label>
          <div className="row gap-2">
            <button type="button" className="chip" aria-pressed={isPlayer} onClick={() => setIsPlayer(true)}>Squad player</button>
            <button type="button" className="chip" aria-pressed={!isPlayer} onClick={() => setIsPlayer(false)}>Supporter</button>
          </div>
          <span className="dim" style={{ fontSize: 12 }}>
            {isPlayer ? 'Picked for the squad and sets availability.' : 'App access only — follows fixtures & results, not in the squad.'}
          </span>
        </div>

        {isPlayer && (
          <div className="field"><label className="label">Team(s)</label>
            <div className="row gap-2">
              {teams.map((t) => (
                <button type="button" key={t.id} className={'chip' + (t.key === 'community' ? ' community' : '')}
                  aria-pressed={teamKeys.includes(t.key)} onClick={() => toggle(teamKeys, setTeamKeys, t.key)}>{t.label}</button>
              ))}
            </div></div>
        )}

        {!adding && (
          <>
            <div className="field"><label className="label">Role &amp; eligibility</label>
              <div className="row gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <select className="select" style={{ width: 'auto' }} value={role} disabled={self} onChange={(e) => setRole(e.target.value)}>
                  <option value="player">Player</option>
                  <option value="admin">Admin</option>
                </select>
                <button type="button" className="chip" aria-pressed={xlEligible} onClick={() => setXlEligible((x) => !x)}>
                  {xlEligible ? 'XL eligible ✓' : 'XL eligible'}
                </button>
                <button type="button" className="chip" aria-pressed={active} disabled={self} onClick={() => setActive((a) => !a)}
                  style={{ color: active ? 'var(--green-bright)' : 'var(--red-bright)' }}>
                  {active ? 'Active' : 'Inactive'}
                </button>
                {isPlayer && (
                  <button type="button" className="chip" aria-pressed={approved} onClick={() => setApproved((a) => !a)}
                    style={{ color: approved ? 'var(--green-bright)' : 'var(--amber)' }}>
                    {approved ? 'Signed off ✓' : 'Pending sign-off'}
                  </button>
                )}
              </div>
              {self && <p className="dim" style={{ fontSize: 12, marginTop: 6 }}>You can't change your own role or deactivate yourself.</p>}
            </div>

            <button type="button" className="btn btn-ghost btn-block" disabled={busy} onClick={resetPassword}>Reset password</button>
          </>
        )}

        <button className="btn btn-primary btn-block mt-2" disabled={busy}>
          {busy ? 'Saving…' : adding ? 'Create player' : 'Save changes'}
        </button>
      </form>
    </Sheet>
  )
}
