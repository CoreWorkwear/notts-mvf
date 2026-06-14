import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  IconFixtures, IconResults, IconClub, IconWhosIn, IconPlayers, IconYou,
} from './Icons'

// Role-gated bottom nav (HANDOVER §5).
// Player: Fixtures · Results · Club · You
// Admin:  Fixtures · Results · Club · Who's In · Players · You
const PLAYER_TABS = [
  { to: '/fixtures', label: 'Fixtures', Icon: IconFixtures },
  { to: '/results',  label: 'Results',  Icon: IconResults },
  { to: '/club',     label: 'Club',     Icon: IconClub },
  { to: '/you',      label: 'You',      Icon: IconYou },
]
const ADMIN_EXTRA = [
  { to: '/whos-in', label: "Who's In", Icon: IconWhosIn },
  { to: '/players', label: 'Players',  Icon: IconPlayers },
]

export default function BottomNav() {
  const { isAdmin } = useAuth()
  const tabs = isAdmin
    ? [...PLAYER_TABS.slice(0, 3), ...ADMIN_EXTRA, PLAYER_TABS[3]]
    : PLAYER_TABS

  return (
    <nav className="bottom-nav">
      {tabs.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
        >
          <Icon width={21} height={21} />
          <span className="nav-label">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
