import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import Crest from '../components/Crest'

// The whole app for an account the manager hasn't signed off (or has switched
// off). The database shows such an account nothing club-wide, so there is no
// app to render: just where they stand, a way to re-check, and a way out.
// No header, no bottom nav, no data hooks.
export default function Holding({ status }) {
  const { profile, refreshProfile, signOut } = useAuth()
  const [checking, setChecking] = useState(false)
  const [checkedOnce, setCheckedOnce] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const inactive = status === 'inactive'
  const kind = profile?.is_player === false ? 'supporter' : 'player'

  async function checkAgain() {
    setChecking(true)
    try { await refreshProfile() } finally { setChecking(false); setCheckedOnce(true) }
  }
  async function leave() {
    setLeaving(true)
    try { await signOut() } finally { setLeaving(false) }
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <div className="page" style={{ paddingTop: 'calc(48px + var(--safe-t))', maxWidth: 460, margin: '0 auto', width: '100%' }}>
        <div className="center">
          <Crest size={56} />
          <h1 className="display mt-3" style={{ fontSize: 34 }}>{inactive ? 'ACCOUNT OFF' : 'NEARLY THERE'}</h1>
          <p className="kicker mt-2"><span className="kicker-rule">{inactive ? 'SWITCHED OFF' : 'AWAITING SIGN-OFF'}</span></p>
        </div>

        <div className="card mt-5" style={{ padding: 16, borderColor: inactive ? 'var(--line-2)' : 'var(--amber)' }} role="status">
          {inactive ? (
            <p>Your account&rsquo;s been switched off. Have a word with the manager if that&rsquo;s a mistake.</p>
          ) : (
            <>
              <p style={{ fontWeight: 600 }}>You&rsquo;re signed up as a {kind}.</p>
              <p className="dim mt-2">
                The manager needs to sign you off before you can see fixtures, results and the squad. You&rsquo;ll get in as soon as they do.
              </p>
            </>
          )}
          {checkedOnce && !checking && (
            <p className="dim mt-3" style={{ fontSize: 13 }}>Nothing&rsquo;s changed yet.</p>
          )}
        </div>

        <div className="col gap-2 mt-4">
          <button className="btn btn-primary btn-block" onClick={checkAgain} disabled={checking}>
            {checking ? 'Checking…' : 'Check again'}
          </button>
          <button className="btn btn-ghost btn-block" onClick={leave} disabled={leaving}>
            {leaving ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
    </div>
  )
}
