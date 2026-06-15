import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { POSITIONS, TEAM_ORDER, TEAMS } from '../lib/constants'
import Crest from '../components/Crest'

// Login + Register. Register captures everything the trigger needs; the server
// forces player / not-eligible regardless of what we send (HANDOVER §3).
export default function Auth() {
  const { signIn, signUp, sendPasswordReset } = useAuth()
  const [tab, setTab] = useState('login')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  // shared
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // register-only
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [positions, setPositions] = useState([])
  const [preferred, setPreferred] = useState('')
  const [teams, setTeams] = useState([])
  const [isPlayer, setIsPlayer] = useState(true) // player vs supporter

  const toggle = (list, set, val) =>
    set(list.includes(val) ? list.filter((x) => x !== val) : [...list, val])

  async function onLogin(e) {
    e.preventDefault()
    setError(null); setBusy(true)
    const { error } = await signIn(email.trim(), password)
    setBusy(false)
    if (error) setError(error.message)
  }

  async function onReset(e) {
    e.preventDefault()
    setError(null); setNotice(null)
    if (!email.trim()) { setError('Pop your email in first.'); return }
    setBusy(true)
    const { error } = await sendPasswordReset(email)
    setBusy(false)
    if (error) { setError(error.message); return }
    setNotice("If that email's registered, a reset link's on its way. Check your inbox.")
    setTab('login')
  }

  async function onRegister(e) {
    e.preventDefault()
    setError(null); setNotice(null)
    // Required: first/last/email/phone/password (mirrors the DB NOT NULLs).
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !phone.trim() || !password) {
      setError('First name, surname, email, phone and password are all needed.')
      return
    }
    if (password.length < 6) { setError('Pick a password of at least 6 characters.'); return }
    if (isPlayer && teams.length === 0) { setError('Pick at least one team.'); return }

    setBusy(true)
    const { data, error } = await signUp({
      email: email.trim(), password,
      first_name: firstName.trim(), last_name: lastName.trim(), phone: phone.trim(),
      positions: isPlayer ? positions : [], preferred: isPlayer ? (preferred || null) : null,
      teams: isPlayer ? teams : [], is_player: isPlayer,
    })
    setBusy(false)
    if (error) { setError(error.message); return }
    if (!data.session) {
      // Email confirmation is on for this project — tell them, in club voice.
      setNotice("You're signed up. Check your email to confirm, then sign in.")
      setTab('login')
    } else {
      setNotice(isPlayer
        ? "You're in — confirm your email, then the manager will sign you off to start marking yourself available."
        : "You're set up as a supporter. Confirm your email and you're good to follow the club.")
    }
  }

  const preferredOptions = positions.length ? positions : POSITIONS

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <div className="page" style={{ paddingTop: 'calc(48px + var(--safe-t))', maxWidth: 460, margin: '0 auto', width: '100%' }}>
        <div className="center">
          <Crest size={56} />
          <h1 className="display mt-3" style={{ fontSize: 34 }}>NOTTS MvF</h1>
          <p className="kicker mt-2"><span className="kicker-rule">TEAM HUB</span></p>
        </div>

        <div className="row gap-2 mt-5" role="tablist">
          <button className={'btn grow ' + (tab === 'login' ? 'btn-primary' : 'btn-ghost')} onClick={() => { setTab('login'); setError(null) }}>Sign in</button>
          <button className={'btn grow ' + (tab === 'register' ? 'btn-primary' : 'btn-ghost')} onClick={() => { setTab('register'); setError(null) }}>Join up</button>
        </div>

        {notice && <p className="mt-4 center" style={{ color: 'var(--green-bright)' }}>{notice}</p>}
        {error && <p className="field-error mt-4 center">{error}</p>}
        <style>{`.auth-link{ background:none; border:none; color:var(--bone-mute); text-decoration:underline; font-size:13px; cursor:pointer; align-self:center; }`}</style>

        {tab === 'login' ? (
          <form className="col gap-3 mt-4" onSubmit={onLogin}>
            <div className="field">
              <label className="label">Email</label>
              <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Password</label>
              <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-block mt-2" disabled={busy}>{busy ? 'Hang on…' : 'Sign in'}</button>
            <button type="button" className="auth-link" onClick={() => { setTab('reset'); setError(null); setNotice(null) }}>Forgot password?</button>
          </form>
        ) : tab === 'reset' ? (
          <form className="col gap-3 mt-4" onSubmit={onReset}>
            <div className="field">
              <label className="label">Email</label>
              <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-block mt-2" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
            <button type="button" className="auth-link" onClick={() => { setTab('login'); setError(null) }}>← Back to sign in</button>
          </form>
        ) : (
          <form className="col gap-3 mt-4" onSubmit={onRegister}>
            <div className="row gap-2">
              <div className="field grow">
                <label className="label">First name</label>
                <input className="input" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div className="field grow">
                <label className="label">Surname</label>
                <input className="input" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label className="label">Phone</label>
              <input className="input" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Email</label>
              <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Password</label>
              <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>

            <div className="field">
              <label className="label">Joining as…</label>
              <div className="row gap-2">
                <button type="button" className="chip grow" aria-pressed={isPlayer} onClick={() => setIsPlayer(true)}>A player</button>
                <button type="button" className="chip grow" aria-pressed={!isPlayer} onClick={() => setIsPlayer(false)}>A supporter</button>
              </div>
              <span className="dim" style={{ fontSize: 12 }}>
                {isPlayer
                  ? 'The manager signs you off before you can mark yourself available.'
                  : "Follow fixtures & results — you won't be picked for the squad."}
              </span>
            </div>

            {isPlayer && (
              <>
                <div className="field">
                  <label className="label">Which team(s)?</label>
                  <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
                    {TEAM_ORDER.map((k) => (
                      <button
                        type="button" key={k}
                        className={'chip' + (k === 'community' ? ' community' : '')}
                        aria-pressed={teams.includes(k)}
                        onClick={() => toggle(teams, setTeams, k)}
                      >{TEAMS[k].label}</button>
                    ))}
                  </div>
                  <span className="dim" style={{ fontSize: 12 }}>You'll join as a player — the manager signs you off for XL.</span>
                </div>

                <div className="field">
                  <label className="label">Positions</label>
                  <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
                    {POSITIONS.map((p) => (
                      <button
                        type="button" key={p} className="chip"
                        aria-pressed={positions.includes(p)}
                        onClick={() => toggle(positions, setPositions, p)}
                      >{p}</button>
                    ))}
                  </div>
                </div>

                <div className="field">
                  <label className="label">Preferred position</label>
                  <select className="select" value={preferred} onChange={(e) => setPreferred(e.target.value)}>
                    <option value="">—</option>
                    {preferredOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </>
            )}

            <button className="btn btn-primary btn-block mt-2" disabled={busy}>{busy ? 'Signing you up…' : isPlayer ? 'Join the squad' : 'Sign up'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
