import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import Crest from './Crest'
import { IconLogout, IconBell, IconManage } from './Icons'
import ThemeToggle from './ThemeToggle'
import Sheet from './Sheet'
import { useAuth } from '../context/AuthContext'
import { useSeason } from '../context/SeasonContext'

// Sticky header: crest, wordmark, season picker (scopes the app), sign-out.
export default function Header() {
  const { signOut, isRealAdmin, managerView, setManagerView } = useAuth()
  const { seasons, seasonId, setSeasonId } = useSeason()
  const [confirming, setConfirming] = useState(false)

  return (
    <>
    <header className={'app-header' + (isRealAdmin ? ' admin' : '')}>
      <Crest size={30} />
      <span className="wordmark grow" aria-hidden="true"><span>Notts MvF</span></span>

      {seasons.length > 0 && (
        <select
          className="select season-select"
          style={{ width: 'auto' }}
          value={seasonId ?? ''}
          onChange={(e) => setSeasonId(e.target.value)}
          aria-label="Season"
        >
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      )}

      {/* §3 Manager view: cosmetic on/off, admins only. Off = the player view. */}
      {isRealAdmin && (
        <button
          className="nav-item mgr-toggle"
          style={{ flex: 'none', color: managerView ? 'var(--red-bright)' : 'var(--bone-mute)' }}
          onClick={() => setManagerView(!managerView)}
          aria-label="Manager view"
          aria-pressed={managerView}
        >
          <IconManage />
        </button>
      )}

      <NavLink
        to="/news"
        className="nav-item"
        style={{ flex: 'none', color: 'var(--bone-mute)' }}
        aria-label="Club news"
      >
        <IconBell />
      </NavLink>

      <ThemeToggle />

      <button
        className="nav-item"
        style={{ flex: 'none', color: 'var(--bone-mute)' }}
        onClick={() => setConfirming(true)}
        aria-label="Sign out"
      >
        <IconLogout />
      </button>

    </header>

    {/* A sibling of the header, never a child: the header's backdrop-filter makes
        it the containing block for anything position: fixed inside it, which
        shrank this backdrop to the header's own height and hung the sheet above
        the top of the screen (e2e/overlays.spec.js). */}
    <Sheet open={confirming} onClose={() => setConfirming(false)}>
      <h2 className="display" style={{ fontSize: 'var(--type-title)' }}>Sign out?</h2>
      <div className="row gap-2 mt-4">
        <button className="btn btn-ghost grow" onClick={() => setConfirming(false)}>Stay</button>
        <button className="btn btn-primary grow" onClick={signOut}>Sign out</button>
      </div>
    </Sheet>
    </>
  )
}
