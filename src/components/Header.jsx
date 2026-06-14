import { useState } from 'react'
import Crest from './Crest'
import { IconLogout } from './Icons'
import ThemeToggle from './ThemeToggle'
import { useAuth } from '../context/AuthContext'
import { useSeason } from '../context/SeasonContext'

// Sticky header: crest, wordmark, season picker (scopes the app), sign-out.
export default function Header() {
  const { signOut } = useAuth()
  const { seasons, seasonId, setSeasonId } = useSeason()
  const [confirming, setConfirming] = useState(false)

  return (
    <header className="app-header">
      <Crest size={30} />
      <span className="wordmark grow">NOTTS MvF</span>

      {seasons.length > 0 && (
        <select
          className="select"
          style={{ width: 'auto', padding: '7px 10px', fontSize: 13 }}
          value={seasonId ?? ''}
          onChange={(e) => setSeasonId(e.target.value)}
          aria-label="Season"
        >
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      )}

      <ThemeToggle />

      <button
        className="nav-item"
        style={{ flex: 'none', color: 'var(--bone-mute)' }}
        onClick={() => setConfirming(true)}
        aria-label="Sign out"
      >
        <IconLogout />
      </button>

      {confirming && (
        <div className="sheet-backdrop" onClick={() => setConfirming(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="grab-handle" />
            <p className="display" style={{ fontSize: 22 }}>Off home, then?</p>
            <p className="muted mt-2">You'll need to sign back in next time.</p>
            <div className="row gap-2 mt-4">
              <button className="btn btn-ghost grow" onClick={() => setConfirming(false)}>Stay</button>
              <button className="btn btn-primary grow" onClick={signOut}>Sign out</button>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
