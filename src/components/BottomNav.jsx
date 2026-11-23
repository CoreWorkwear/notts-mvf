import { useLayoutEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { SPRING_SNAPPY } from '../lib/motion'
import {
  IconFixtures, IconResults, IconClub, IconManage, IconYou,
} from './Icons'

// Role-gated bottom nav (HANDOVER §5). Admin/config screens live behind a single
// "Manage" hub rather than crowding the bar with extra tabs.
// Player: Fixtures · Results · Club · You
// Admin:  Fixtures · Results · Club · Manage · You

const PLAYER_TABS = [
  { to: '/fixtures', label: 'Fixtures', Icon: IconFixtures },
  { to: '/results',  label: 'Results',  Icon: IconResults },
  { to: '/club',     label: 'Club',     Icon: IconClub },
  { to: '/you',      label: 'You',      Icon: IconYou },
]
const MANAGE_TAB = { to: '/manage', label: 'Manage', Icon: IconManage }

export default function BottomNav() {
  const rail = useRef(null)
  const reduce = useReducedMotion()
  const { pathname } = useLocation()
  const adminSubpage = /^\/(players|whos-in|competitions|opponents|seasons|sponsors|media|reminders|diagnostics|news)\/?$/.test(pathname)
  const { isAdmin } = useAuth()
  useLayoutEffect(() => {
    const nav = rail.current
    const root = document.documentElement
    function fit() {
      const bounds = nav.getBoundingClientRect()
      root.style.setProperty('--nav-height', bounds.height + 'px')
      const active = nav.querySelector('[aria-current]')?.getBoundingClientRect()
      if (!active) return
      const style = getComputedStyle(nav)
      const right = bounds.right - parseFloat(style.paddingRight || 0)
      const left = bounds.left + parseFloat(style.paddingLeft || 0)
      if (active.right > right) nav.scrollLeft += Math.ceil(active.right - right)
      if (active.left < left) nav.scrollLeft -= Math.ceil(left - active.left)
    }
    fit()
    const observer = window.ResizeObserver && new ResizeObserver(fit)
    observer?.observe(nav)
    for (const link of nav.children) observer?.observe(link)
    return () => {
      observer?.disconnect()
      root.style.removeProperty('--nav-height')
    }
  }, [pathname, isAdmin])
  const tabs = isAdmin
    ? [...PLAYER_TABS.slice(0, 3), MANAGE_TAB, PLAYER_TABS[3]]
    : PLAYER_TABS

  return (
    <nav ref={rail} className="bottom-nav" aria-label="Club navigation">
      {tabs.map(({ to, label, Icon }) => {
        const current = pathname === to ? 'page' : to === '/manage' && adminSubpage ? 'location' : undefined
        return <Link key={to} to={to} aria-current={current} className={'nav-item' + (current ? ' active' : '')}>
          {current && <motion.span className="nav-rule" aria-hidden="true"
            layoutId={reduce ? undefined : 'club-navigation-active'} transition={SPRING_SNAPPY} />}
          <Icon width={21} height={21} aria-hidden="true" />
          <span className="nav-label">{label}</span>
        </Link>
      })}
    </nav>
  )
}
