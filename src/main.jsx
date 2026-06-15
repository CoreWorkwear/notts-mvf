import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './styles/tokens.css'

// Keep installed apps current. An installed Android PWA only re-checks the
// service worker on navigation/~daily, so it can sit on a stale build. Poll for
// a new build hourly AND whenever the app returns to the foreground; with
// registerType:'autoUpdate' a found update is applied + reloaded automatically.
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, r) {
    if (!r) return
    setInterval(() => r.update(), 60 * 60 * 1000)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') r.update()
    })
  },
})
import App from './App'
import GrainOverlay from './components/GrainOverlay'
import InstallPrompt from './components/InstallPrompt'
import PushActions from './components/PushActions'
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
            <InstallPrompt />
            <PushActions />
          </SeasonProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
)
