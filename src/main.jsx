import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerForUpdates } from './lib/pwaUpdate'
import { installGlobalErrorLogging } from './lib/logger'
import { reloadOnceOnPreloadError, clearPreloadReloadFlag } from './lib/preloadReload'
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/motion.css'
import './styles/club-tools.css'

// Catch uncaught errors + unhandled promise rejections app-wide.
installGlobalErrorLogging()

// A lazy chunk that has vanished after a deploy: reload once to pick up the new
// build (guarded against loops), and say so in the error log.
window.addEventListener('vite:preloadError', (e) => reloadOnceOnPreloadError(e))
// Once this load has settled the guard is spent, so a LATER deploy can reload once too.
window.addEventListener('load', () => setTimeout(clearPreloadReloadFlag, 10_000))

if (import.meta.env.PROD) registerForUpdates()
import App from './App'
import UpdatePrompt from './components/UpdatePrompt'
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
            <UpdatePrompt />
            <PushActions />
          </SeasonProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
)
