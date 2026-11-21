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
  const kind = profile?.is_player === false ? 'Supporter' : 'Player'

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
      <div className="page" style={{ paddingTop: 'calc(var(--space-12) + var(--safe-t))', maxWidth: 460, margin: '0 auto', width: '100%' }}>
        <div className="center">
          <Crest size={56} />
          <h1 className="display mt-3" style={{ fontSize: 'var(--type-poster)' }}>{inactive ? 'Account inactive' : 'Awaiting manager sign-off'}</h1>
        </div>

        <div className="card mt-5" style={{ padding: 'var(--space-4)' }} role="status">
          <p className="row spread"><span className="dim">Account type</span><strong>{kind}</strong></p>
          {inactive && <p className="mt-2">Contact your manager</p>}
          {checkedOnce && !checking && <p className="dim mt-2">Status unchanged</p>}
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
