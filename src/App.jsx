import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { MotionConfig, AnimatePresence, motion } from 'framer-motion'
import { pageTransition } from './lib/motion'
import { breadcrumb } from './lib/breadcrumbs'
import { useAuth } from './context/AuthContext'
import Header from './components/Header'
import BottomNav from './components/BottomNav'
import Loader from './components/Loader'
import Auth from './pages/Auth'
import SetNewPassword from './pages/SetNewPassword'
import Fixtures from './pages/Fixtures'
import Results from './pages/Results'
import Club from './pages/Club'
import Profile from './pages/Profile'
import News from './pages/News'
import SponsorStrip from './components/SponsorStrip'

// Admin-only pages are code-split: a player's phone never parses the
// management suite (it was two-thirds of the routes in one 750 kB chunk).
// The service worker still precaches every chunk, so an admin's screens are
// instant and offline-safe after first load.
const Manage = lazy(() => import('./pages/Manage'))
const AdminAvailability = lazy(() => import('./pages/AdminAvailability'))
const Players = lazy(() => import('./pages/Players'))
const Opponents = lazy(() => import('./pages/Opponents'))
const Seasons = lazy(() => import('./pages/Seasons'))
const Media = lazy(() => import('./pages/Media'))
const Reminders = lazy(() => import('./pages/Reminders'))
const Sponsors = lazy(() => import('./pages/Sponsors'))
const Diagnostics = lazy(() => import('./pages/Diagnostics'))
const Competitions = lazy(() => import('./pages/Competitions'))

export default function App() {
  const { loading, isAuthed, isAdmin, profile, passwordRecovery } = useAuth()

  if (loading) return <Loader label="Warming up…" />
  if (passwordRecovery) return <SetNewPassword />
  if (!isAuthed) return <Auth />

  // Admin-only routes fall back to Fixtures for players. Not knowing yet is
  // not "not an admin": while the profile is still loading (a slow signal
  // after the safety timer lifted the splash) hold the screen rather than
  // <Navigate replace> a manager off /players on every cold start.
  const adminOnly = (el) => (isAdmin ? el : profile ? <Navigate to="/fixtures" replace /> : <Loader label="Warming up…" />)

  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <RouteBreadcrumbs />
        <PushNavigate />
        <Header />
        <AnimatedRoutes adminOnly={adminOnly} />
        <BottomNav />
      </BrowserRouter>
    </MotionConfig>
  )
}

// Every route change leaves a breadcrumb, so an error row in Diagnostics shows
// the screens the player walked through to reach it.
function RouteBreadcrumbs() {
  const { pathname } = useLocation()
  useEffect(() => { breadcrumb('nav', pathname) }, [pathname])
  return null
}

// A tapped news / line-up notification with the app already open: the service
// worker posts the deep link, PushActions re-broadcasts it as a window event,
// and this moves the router there. Only same-app paths are honoured.
function PushNavigate() {
  const navigate = useNavigate()
  useEffect(() => {
    const onNav = (e) => {
      const url = e.detail?.url
      if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) navigate(url)
    }
    window.addEventListener('mvf-navigate', onNav)
    return () => window.removeEventListener('mvf-navigate', onNav)
  }, [navigate])
  return null
}

// Route content crossfades + drifts up on navigation (DESIGN-SYSTEM §5). The
// header, bottom nav and sponsor strip live outside the transition so only the
// page body moves. Keyed on pathname so AnimatePresence sees each route swap.
function AnimatedRoutes({ adminOnly }) {
  const location = useLocation()
  return (
    <main>
      <AnimatePresence mode="wait">
        <motion.div key={location.pathname} {...pageTransition}>
          <Suspense fallback={<Loader label="Opening…" />}>
          <Routes location={location}>
            <Route path="/fixtures" element={<Fixtures />} />
            <Route path="/results" element={<Results />} />
            <Route path="/club" element={<Club />} />
            <Route path="/you" element={<Profile />} />
            <Route path="/news" element={<News />} />
            <Route path="/manage" element={adminOnly(<Manage />)} />
            <Route path="/whos-in" element={adminOnly(<AdminAvailability />)} />
            <Route path="/players" element={adminOnly(<Players />)} />
            <Route path="/opponents" element={adminOnly(<Opponents />)} />
            <Route path="/seasons" element={adminOnly(<Seasons />)} />
            <Route path="/media" element={adminOnly(<Media />)} />
            <Route path="/reminders" element={adminOnly(<Reminders />)} />
            <Route path="/sponsors" element={adminOnly(<Sponsors />)} />
            <Route path="/diagnostics" element={adminOnly(<Diagnostics />)} />
            <Route path="/competitions" element={adminOnly(<Competitions />)} />
            <Route path="*" element={<Navigate to="/fixtures" replace />} />
          </Routes>
          </Suspense>
        </motion.div>
      </AnimatePresence>
      <SponsorStrip />
    </main>
  )
}
