import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
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
