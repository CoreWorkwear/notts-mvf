import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { installGlobalErrorLogging } from './lib/logger'
import './styles/tokens.css'

// Catch uncaught errors + unhandled promise rejections app-wide.
installGlobalErrorLogging()

// Keep installed apps current WITHOUT interrupting a launch. An installed Android
// PWA only re-checks the service worker on navigation/~daily, so we still poll for
// a new build hourly AND whenever the app returns to the foreground — but with
// registerType:'prompt' a found update is NOT auto-applied (that reloaded the page
// mid-startup = the cold-start hang). Instead onNeedRefresh surfaces a quiet
// "Refresh" prompt (UpdatePrompt) the user taps when it suits them.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    window.__mvfUpdateSW = () => updateSW(true) // applies the update + reloads, on tap
    window.dispatchEvent(new Event('mvf-sw-update'))
  },
  onRegisteredSW(_swUrl, r) {
    if (!r) return
    // update() rejects whenever the phone happens to be offline — expected on
    // a background poll, so swallow it (it was ~80% of the client error log).
    setInterval(() => r.update().catch(() => {}), 60 * 60 * 1000)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') r.update().catch(() => {})
    })
  },
})
import App from './App'
import GrainOverlay from './components/GrainOverlay'
import InstallPrompt from './components/InstallPrompt'
import UpdatePrompt from './components/UpdatePrompt'
import PushActions from './components/PushActions'
import NotificationPrompt from './components/NotificationPrompt'
import ErrorBoundary from './components/ErrorBoundary'
import { ThemeProvider } from './context/ThemeContext'
import { AuthProvider } from './context/AuthContext'
import { SeasonProvider } from './context/SeasonContext'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <SeasonProvider>
            <App />
            <GrainOverlay />
            <UpdatePrompt />
            <InstallPrompt />
            <PushActions />
            <NotificationPrompt />
          </SeasonProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
)
