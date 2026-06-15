import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
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
import AdminAvailability from './pages/AdminAvailability'
import Players from './pages/Players'
import News from './pages/News'
import Manage from './pages/Manage'
import Opponents from './pages/Opponents'
import Seasons from './pages/Seasons'
import Media from './pages/Media'
import Reminders from './pages/Reminders'
import Sponsors from './pages/Sponsors'
import SponsorStrip from './components/SponsorStrip'

export default function App() {
  const { loading, isAuthed, isAdmin, passwordRecovery } = useAuth()

  if (loading) return <Loader label="Warming up…" />
  if (passwordRecovery) return <SetNewPassword />
  if (!isAuthed) return <Auth />

  // Admin-only routes fall back to Fixtures for players.
  const adminOnly = (el) => (isAdmin ? el : <Navigate to="/fixtures" replace />)

  return (
    <BrowserRouter>
      <Header />
      <main>
        <Routes>
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
          <Route path="*" element={<Navigate to="/fixtures" replace />} />
        </Routes>
        <SponsorStrip />
      </main>
      <BottomNav />
    </BrowserRouter>
  )
}
