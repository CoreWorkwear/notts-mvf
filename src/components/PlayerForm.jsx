import { useEffect, useState } from 'react'
import Sheet from './Sheet'
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
  const [password, setPassword] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    if (!open) return
    setError(null); setNotice(null); setPassword('')
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
    if (v) { setError(v); return }
    setError(null); setBusy(true)
    try {
      if (adding) {
        // Create the login without disturbing the admin's session.
        const tmp = makeSignupClient()
        const { error } = await tmp.auth.signUp({
          email: email.trim(),
          password,
          options: { data: {
            first_name: firstName.trim(), last_name: lastName.trim(), phone: phone.trim(),
            dob: dob || null, positions, preferred: preferred || null, teams: teamKeys,
          } },
        })
        if (error) throw error
        // role/eligibility are forced player/false by the trigger — admin can
        // promote on a follow-up edit.
      } else {
        // Duplicate-email guard (excluding this player).
        const { data: dupe } = await supabase.from('profiles').select('id').eq('email', email.trim()).neq('id', player.id)
        if (dupe && dupe.length) throw new Error('Another player already uses that email.')

        const { error: upErr } = await supabase.from('profiles').update({
          first_name: firstName.trim(), last_name: lastName.trim(), email: email.trim(), phone: phone.trim(),
          dob: dob || null, ec_name: ecName.trim() || null, ec_phone: ecPhone.trim() || null,
          positions, preferred: preferred || null,
          xl_eligible: xlEligible, role, active,
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
      <p className="kicker"><span className="kicker-rule">{adding ? 'ADD PLAYER' : 'EDIT PLAYER'}</span></p>
      <h2 className="display mt-2" style={{ fontSize: 24 }}>{adding ? 'New player' : `${firstName} ${lastName}`}</h2>

      {error && <p className="field-error mt-3">{error}</p>}
      {notice && <p className="mt-3" style={{ color: 'var(--green-bright)', fontSize: 14 }}>{notice}</p>}

      <form className="col gap-3 mt-4" onSubmit={onSubmit}>
        <div className="row gap-2">
          <div className="field grow"><label className="label">First name</label>
            <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
          <div className="field grow"><label className="label">Surname</label>
            <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
        </div>
        <div className="field"><label className="label">Email {adding ? '(their login)' : ''}</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label className="label">Phone</label>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>

        {adding && (
          <div className="field"><label className="label">Starter password (hand this over)</label>
            <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 6 characters" /></div>
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

        <div className="field"><label className="label">Positions</label>
          <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
            {POSITIONS.map((p) => (
              <button type="button" key={p} className="chip" aria-pressed={positions.includes(p)} onClick={() => toggle(positions, setPositions, p)}>{p}</button>
            ))}
          </div></div>

        <div className="field"><label className="label">Team(s)</label>
          <div className="row gap-2">
            {teams.map((t) => (
              <button type="button" key={t.id} className={'chip' + (t.key === 'community' ? ' community' : '')}
                aria-pressed={teamKeys.includes(t.key)} onClick={() => toggle(teamKeys, setTeamKeys, t.key)}>{t.label}</button>
            ))}
          </div></div>

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
