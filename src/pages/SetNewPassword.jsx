import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import Crest from '../components/Crest'

// Shown when the user arrives via a password-reset email (recovery session).
// They set a new password; on success we drop the recovery flag and the app
// renders normally (they're signed in).
export default function SetNewPassword() {
  const { updatePassword, endRecovery } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function onSubmit(e) {
    e.preventDefault()
    if (password.length < 6) { setError('Pick a password of at least 6 characters.'); return }
    if (password !== confirm) { setError("Those passwords don't match."); return }
    setError(null); setBusy(true)
    const { error } = await updatePassword(password)
    setBusy(false)
    if (error) { setError(error.message); return }
    endRecovery() // signed in with the new password → app takes over
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <div className="page" style={{ paddingTop: 'calc(48px + var(--safe-t))', maxWidth: 460, margin: '0 auto', width: '100%' }}>
        <div className="center">
          <Crest size={56} />
          <h1 className="display mt-3" style={{ fontSize: 30 }}>New password</h1>
          <p className="kicker mt-2"><span className="kicker-rule">RESET</span></p>
        </div>

        {error && <p className="field-error mt-4 center">{error}</p>}

        <form className="col gap-3 mt-4" onSubmit={onSubmit}>
          <div className="field">
            <label className="label">New password</label>
            <input className="input" type="password" autoComplete="new-password" aria-label="New password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Confirm password</label>
            <input className="input" type="password" autoComplete="new-password" aria-label="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <button className="btn btn-primary btn-block mt-2" disabled={busy}>{busy ? 'Saving…' : 'Set password & sign in'}</button>
        </form>
      </div>
    </div>
  )
}
