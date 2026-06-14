import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Header from './components/Header'
import BottomNav from './components/BottomNav'
import Loader from './components/Loader'
import Auth from './pages/Auth'
import Fixtures from './pages/Fixtures'
import Results from './pages/Results'
import Club from './pages/Club'
import Profile from './pages/Profile'
import AdminAvailability from './pages/AdminAvailability'
import Players from './pages/Players'

export default function App() {
  const { loading, isAuthed, isAdmin } = useAuth()

  if (loading) return <Loader label="Warming up…" />
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
          <Route path="/whos-in" element={adminOnly(<AdminAvailability />)} />
          <Route path="/players" element={adminOnly(<Players />)} />
          <Route path="*" element={<Navigate to="/fixtures" replace />} />
        </Routes>
      </main>
      <BottomNav />
    </BrowserRouter>
  )
}
