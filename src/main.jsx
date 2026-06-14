import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import App from './App'
import GrainOverlay from './components/GrainOverlay'
import { AuthProvider } from './context/AuthContext'
import { SeasonProvider } from './context/SeasonContext'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <SeasonProvider>
        <App />
        <GrainOverlay />
      </SeasonProvider>
    </AuthProvider>
  </StrictMode>
)
