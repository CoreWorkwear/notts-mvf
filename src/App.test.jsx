import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

// Route gating. `adminOnly` used to read isAdmin=false while the profile was
// still loading and <Navigate replace> a manager off /players (or an installed
// PWA resuming on /whos-in) to /fixtures on every cold start — with `replace`,
// so Back couldn't recover it. Not knowing yet is not "not an admin".
const auth = vi.hoisted(() => ({ state: {} }))
vi.mock('./context/AuthContext', () => ({ useAuth: () => auth.state }))
vi.mock('./components/Header', () => ({ default: () => null }))
vi.mock('./components/BottomNav', () => ({ default: () => null }))
vi.mock('./components/SponsorStrip', () => ({ default: () => null }))
vi.mock('./components/Loader', () => ({ default: ({ label }) => <div>LOADER {label}</div> }))
vi.mock('./pages/Auth', () => ({ default: () => <div>AUTH-PAGE</div> }))
vi.mock('./pages/SetNewPassword', () => ({ default: () => <div>SET-PASSWORD</div> }))
vi.mock('./pages/Fixtures', () => ({ default: () => <div>FIXTURES-PAGE</div> }))
vi.mock('./pages/Results', () => ({ default: () => <div>RESULTS-PAGE</div> }))
vi.mock('./pages/Club', () => ({ default: () => <div>CLUB-PAGE</div> }))
vi.mock('./pages/Profile', () => ({ default: () => <div>PROFILE-PAGE</div> }))
vi.mock('./pages/News', () => ({ default: () => <div>NEWS-PAGE</div> }))
vi.mock('./pages/Players', () => ({ default: () => <div>PLAYERS-PAGE</div> }))
vi.mock('./pages/Manage', () => ({ default: () => <div>MANAGE-PAGE</div> }))
vi.mock('./pages/AdminAvailability', () => ({ default: () => null }))
vi.mock('./pages/Opponents', () => ({ default: () => null }))
vi.mock('./pages/Seasons', () => ({ default: () => null }))
vi.mock('./pages/Media', () => ({ default: () => null }))
vi.mock('./pages/Reminders', () => ({ default: () => null }))
vi.mock('./pages/Sponsors', () => ({ default: () => null }))
vi.mock('./pages/Diagnostics', () => ({ default: () => null }))
vi.mock('./pages/Competitions', () => ({ default: () => null }))

import App from './App'

const base = { loading: false, isAuthed: true, isAdmin: false, profile: null, passwordRecovery: false }

beforeEach(() => { auth.state = { ...base } })
afterEach(() => { window.history.replaceState({}, '', '/') })

describe('App — admin routes while the profile is still unknown', () => {
  test('a not-yet-loaded profile on /players shows the loader and STAYS on /players', async () => {
    window.history.replaceState({}, '', '/players')
    auth.state = { ...base, profile: null, isAdmin: false }
    render(<App />)
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    expect(window.location.pathname).toBe('/players')
    expect(screen.getByText(/LOADER/)).toBeInTheDocument()
  })

  test('a loaded non-admin profile on /players is sent to /fixtures', async () => {
    window.history.replaceState({}, '', '/players')
    auth.state = { ...base, profile: { id: 'u1', role: 'player' }, isAdmin: false }
    render(<App />)
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    expect(window.location.pathname).toBe('/fixtures')
  })

  test('an admin on /players gets the Players page', async () => {
    window.history.replaceState({}, '', '/players')
    auth.state = { ...base, profile: { id: 'u1', role: 'admin' }, isAdmin: true }
    render(<App />)
    expect(await screen.findByText('PLAYERS-PAGE')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/players')
  })
})

describe('App — a tapped push notification navigates the open app', () => {
  test('an mvf-navigate window event moves to that route', async () => {
    window.history.replaceState({}, '', '/fixtures')
    auth.state = { ...base, profile: { id: 'u1', role: 'player' } }
    render(<App />)
    await act(async () => { window.dispatchEvent(new CustomEvent('mvf-navigate', { detail: { url: '/news' } })) })
    expect(window.location.pathname).toBe('/news')
    expect(await screen.findByText('NEWS-PAGE')).toBeInTheDocument()
  })

  test('only same-app paths are honoured', async () => {
    window.history.replaceState({}, '', '/fixtures')
    auth.state = { ...base, profile: { id: 'u1', role: 'player' } }
    render(<App />)
    await act(async () => { window.dispatchEvent(new CustomEvent('mvf-navigate', { detail: { url: 'https://evil.example/x' } })) })
    expect(window.location.pathname).toBe('/fixtures')
  })
})
