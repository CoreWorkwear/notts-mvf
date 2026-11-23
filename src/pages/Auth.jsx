import PreferredPosition from '../components/PreferredPosition'
import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { MIN_PASSWORD, POSITIONS, TEAM_ORDER, TEAMS } from '../lib/constants'
import Crest from '../components/Crest'
import Toast from '../components/Toast'
import Segmented from '../components/Segmented'

// Login + Register. Register captures everything the trigger needs; the server
// forces player / not-eligible regardless of what we send (HANDOVER §3).
export default function Auth() {
  const { signIn, signUp, sendPasswordReset, authNotice, clearAuthNotice } = useAuth()
  const [tab, setTab] = useState('login')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  // A failed recovery link (expired / already used) lands here — say so
  // through the existing error toast instead of a silent sign-in screen.
  useEffect(() => {
    if (authNotice) { setError(authNotice); clearAuthNotice() }
  }, [authNotice, clearAuthNotice])

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
    if (!email.trim()) { setError('Enter your email first.'); return }
    setBusy(true)
    const { error } = await sendPasswordReset(email)
    setBusy(false)
    if (error) { setError(error.message); return }
    setNotice('If that email’s registered, check your inbox for a reset link.')
    setTab('login')
  }

  async function onRegister(e) {
    e.preventDefault()
    setError(null); setNotice(null)
    // Required: first/last/email/phone/password (mirrors the DB NOT NULLs).
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !phone.trim() || !password) {
      setError('Enter your first name, surname, email, phone and password.')
      return
    }
    if (password.length < MIN_PASSWORD) { setError(`Use at least ${MIN_PASSWORD} characters for your password.`); return }
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
      setNotice('Confirm your email, then sign in.')
      setTab('login')
    } else {
      setNotice(isPlayer
        ? 'Registered. Awaiting manager approval.'
        : 'Registered as a supporter.')
    }
  }

  const preferredOptions = positions.length ? positions : POSITIONS

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <div className="page" style={{ paddingTop: 'calc(var(--space-12) + var(--safe-t))', maxWidth: 460, margin: '0 auto', width: '100%' }}>
        <div className="center">
          <Crest size={56} />
          <h1 className="display mt-3" style={{ fontSize: 'var(--type-poster)' }}>Notts MvF</h1>
        </div>

        {/* A switch between two forms, not two calls to action. It used to be two
            full-width buttons, one filled brand red — which put the loudest
            control on the screen next to the actual submit button, also filled
            brand red, and made you read both to work out which one signs you in. */}
        <div className="row center mt-5" style={{ justifyContent: 'center' }}>
          <Segmented
            id="auth-tab"
            value={tab}
            onChange={(k) => { setTab(k); setError(null) }}
            options={[{ key: 'login', label: 'Sign in' }, { key: 'register', label: 'Join up' }]}
          />
        </div>

        {/* Pop-up Toast (fixed, always in view) — never an inline error that can
            scroll off-screen on the long register form (regression: the
            off-screen-error class, now E2E-guarded). */}
        <Toast message={error} tone="error" onDismiss={() => setError(null)} />
        <Toast message={notice} tone="success" onDismiss={() => setNotice(null)} />
        {/* The underline draws in from the left on hover rather than being
            permanently on (.ul-draw, styles/motion.css). */}
        <style>{`.auth-link{ background:none; border:none; color:var(--bone-mute); font-size:var(--type-sm); cursor:pointer; align-self:center; padding:var(--space-1) var(--space-1); }
          .auth-link:hover{ color:var(--bone); }`}</style>

        {tab === 'login' ? (
          <form className="col gap-3 mt-4" onSubmit={onLogin}>
            <div className="field">
              <label className="label">Email</label>
              <input className="input" type="email" aria-label="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Password</label>
              <input className="input" type="password" aria-label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-block mt-2" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
            <button type="button" className="auth-link ul-draw" onClick={() => { setTab('reset'); setError(null); setNotice(null) }}>Forgot password?</button>
          </form>
        ) : tab === 'reset' ? (
          <form className="col gap-3 mt-4" onSubmit={onReset}>
            <div className="field">
              <label className="label">Email</label>
              <input className="input" type="email" aria-label="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-block mt-2" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
            <button type="button" className="auth-link ul-draw" onClick={() => { setTab('login'); setError(null) }}>Back to sign in</button>
          </form>
        ) : (
          <form className="col gap-3 mt-4" onSubmit={onRegister}>
            <div className="row gap-2">
              <div className="field grow">
                <label className="label">First name</label>
                <input className="input" aria-label="First name" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div className="field grow">
                <label className="label">Surname</label>
                <input className="input" aria-label="Surname" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label className="label">Phone</label>
              <input className="input" type="tel" aria-label="Phone" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Email</label>
              <input className="input" type="email" aria-label="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Password</label>
              <input className="input" type="password" aria-label="Password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>

            <div className="field">
              <span className="label" id="role-label">Joining as</span>
              <div className="row gap-2" role="group" aria-labelledby="role-label" aria-describedby="role-help">
                <button type="button" className="chip grow" aria-pressed={isPlayer} onClick={() => setIsPlayer(true)}>Player</button>
                <button type="button" className="chip grow" aria-pressed={!isPlayer} onClick={() => setIsPlayer(false)}>Supporter</button>
              </div>
              <span className="dim" id="role-help" style={{ fontSize: 'var(--type-caption)' }}>
                {isPlayer
                  ? 'Manager approval required for availability.'
                  : 'Fixtures and results access.'}
              </span>
            </div>

            {isPlayer && (
              <>
                <div className="field">
                  <span className="label" id="squads-label">Requested squads</span>
                  <div className="row gap-2" role="group" aria-labelledby="squads-label" aria-describedby="squads-help" style={{ flexWrap: 'wrap' }}>
                    {TEAM_ORDER.map((k) => (
                      <button
                        type="button" key={k}
                        className={'chip ' + k}
                        aria-pressed={teams.includes(k)}
                        onClick={() => toggle(teams, setTeams, k)}
                      >{TEAMS[k].label}</button>
                    ))}
                  </div>
                  <span className="dim" id="squads-help" style={{ fontSize: 'var(--type-caption)' }}>Choose one or both.</span>
                </div>

                <details className="optional-positions">
                  <summary>Playing positions (optional)</summary>
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

                  <PreferredPosition value={preferred} onChange={setPreferred} options={preferredOptions} />
                </details>
              </>
            )}

            <button className="btn btn-primary btn-block mt-2" disabled={busy}>{busy ? 'Signing you up…' : isPlayer ? 'Join the squad' : 'Sign up'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
