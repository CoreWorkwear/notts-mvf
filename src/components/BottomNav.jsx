import { NavLink } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { indicatorTransition } from '../lib/motion'
import {
  IconFixtures, IconResults, IconClub, IconManage, IconYou,
} from './Icons'

// Role-gated bottom nav (HANDOVER §5). Admin/config screens live behind a single
// "Manage" hub rather than crowding the bar with extra tabs.
// Player: Fixtures · Results · Club · You
// Admin:  Fixtures · Results · Club · Manage · You
//
// The active tab is marked by a short rule that SLIDES between tabs (one shared
// layoutId) rather than a colour that blinks from one label to another. It is
// the only thing on screen that tells you where you are, so it earns the motion.
const PLAYER_TABS = [
  { to: '/fixtures', label: 'Fixtures', Icon: IconFixtures },
  { to: '/results',  label: 'Results',  Icon: IconResults },
  { to: '/club',     label: 'Club',     Icon: IconClub },
  { to: '/you',      label: 'You',      Icon: IconYou },
]
const MANAGE_TAB = { to: '/manage', label: 'Manage', Icon: IconManage }

export default function BottomNav() {
  const { isAdmin } = useAuth()
  const tabs = isAdmin
    ? [...PLAYER_TABS.slice(0, 3), MANAGE_TAB, PLAYER_TABS[3]]
    : PLAYER_TABS

  return (
    <nav className="bottom-nav">
      {tabs.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.span className="nav-rule" layoutId="nav-rule" transition={indicatorTransition} />
              )}
              <Icon width={21} height={21} />
              <span className="nav-label">{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
