import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import { breadcrumb } from './lib/breadcrumbs'
import { safeAppPath } from './lib/navigation'
import { useAuth } from './context/AuthContext'
import OfflineDiary from './components/OfflineDiary'
import Header from './components/Header'
import BottomNav from './components/BottomNav'
import Loader from './components/Loader'
import Auth from './pages/Auth'
import SetNewPassword from './pages/SetNewPassword'
import Holding from './pages/Holding'
import Fixtures from './pages/Fixtures'
import Results from './pages/Results'
import Club from './pages/Club'
import Profile from './pages/Profile'
import News from './pages/News'
import SponsorStrip from './components/SponsorStrip'
import { TrainingNoticeBanner } from './components/TrainingNoticeInbox'

// Admin-only pages are code-split: a player's phone never parses the
// management suite (it was two-thirds of the routes in one 750 kB chunk).
// The service worker still precaches every chunk, so an admin's screens are
// instant and offline-safe after first load.
const Training = lazy(() => import('./pages/Training'))
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
  const { loading, isAuthed, isAdmin, profile, passwordRecovery, reconnecting, holding } = useAuth()

  if (loading) return <Loader label="Loading…" />
  if (passwordRecovery) return <SetNewPassword />
  // Signed in on this phone, but the session could not be refreshed yet (no
  // signal at the ground). Not the sign-in form: there is nothing to type.
  if (!isAuthed && reconnecting) return <Reconnect />
  if (!isAuthed) return <Auth />
  // Not signed off yet (or switched off): the database shows this account
  // nothing club-wide, so there is no app to show — no shell, no nav, no data
  // hooks. Admins are never held.
  if (holding) return <Holding status={holding} />

  // Admin-only routes fall back to Fixtures for players. Not knowing yet is
  // not "not an admin": while the profile is still loading (a slow signal
  // after the safety timer lifted the splash) hold the screen rather than
  // <Navigate replace> a manager off /players on every cold start.
  const adminOnly = (el) => (isAdmin ? el : profile ? <Navigate to="/fixtures" replace /> : <Loader label="Loading…" />)

  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <RouteBreadcrumbs />
        <ScrollToTop />
        <PushNavigate />
        <Header />
        <OfflineDiary />
        <AppRoutes adminOnly={adminOnly} />
        <BottomNav />
      </BrowserRouter>
    </MotionConfig>
  )
}

// Shown in place of the sign-in form when a stored session is waiting on a
// token refresh. supabase-js keeps retrying on its own and the app appears the
// moment one lands; the button is for the player who would rather not wait.
// How long "Try again" waits before handing the button back. supabase-js can
// sit in refresh backoff for most of a minute on a dead signal; the attempt
// carries on underneath and still brings the app up if it lands.
const RETRY_PATIENCE_MS = 8000

function Reconnect() {
  const { retryRestore, signInInstead } = useAuth()
  const [busy, setBusy] = useState(false)
  async function again() {
    setBusy(true)
    let timer
    try {
      await Promise.race([
        Promise.resolve(retryRestore()).catch(() => false),
        new Promise((r) => { timer = setTimeout(r, RETRY_PATIENCE_MS) }),
      ])
    } finally { clearTimeout(timer); setBusy(false) }
  }
  return (
    <div className="page">
      <OfflineDiary />
      <div className="empty mt-5" role="alert">
        <p className="empty-title">Can't reach the club</p>
        <p>Still signed in. Check your connection.</p>
        <button className="btn btn-primary mt-3" disabled={busy} onClick={again}>{busy ? 'Trying…' : 'Try again'}</button>
        <div><button className="btn btn-ghost mt-2" onClick={signInInstead}>Sign in instead</button></div>
      </div>
    </div>
  )
}

// Every route change leaves a breadcrumb, so an error row in Diagnostics shows
// the screens the player walked through to reach it.
function RouteBreadcrumbs() {
  const { pathname } = useLocation()
  useEffect(() => { breadcrumb('nav', pathname) }, [pathname])
  return null
}

// Land at the top of a new screen. Scrolled halfway down Fixtures and tapping
// Results used to drop you into the middle of the results list. Instant, not
// smooth: the content has already been replaced, so animating the scroll would
// just be a slide through someone else's page.
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname])
  return null
}

// A tapped news / line-up notification with the app already open: the service
// worker posts the deep link, PushActions re-broadcasts it as a window event,
// and this moves the router there. Only same-app paths are honoured.
function PushNavigate() {
  const navigate = useNavigate()
  useEffect(() => {
    const onNav = (e) => {
      // safeAppPath, not a startsWith check: `/\evil.com` passes "starts with /
      // and not //" and then leaves the app entirely once the browser
      // normalises the backslash (CVE-2025-68470's bypass).
      const path = safeAppPath(e.detail?.url)
      if (path) navigate(path)
    }
    window.addEventListener('mvf-navigate', onNav)
    return () => window.removeEventListener('mvf-navigate', onNav)
  }, [navigate])
  return null
}

function AppRoutes({ adminOnly }) {
  const location = useLocation()
  return (
    <main>
      {!/^\/training\/?$/.test(location.pathname) && <TrainingNoticeBanner />}
      <div key={location.pathname}>
          <Suspense fallback={<Loader label="Loading…" />}>
          <Routes location={location}>
            <Route path="/fixtures" element={<Fixtures />} />
            <Route path="/training" element={<Training />} />
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
        </div>
      <SponsorStrip />
    </main>
  )
}
