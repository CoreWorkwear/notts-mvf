import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState } from 'react'

const ThemeContext = createContext(null)
const systemQuery = '(prefers-color-scheme: dark)'

function readPreference() {
  try {
    const saved = localStorage.getItem('theme')
    if (saved === 'light' || saved === 'dark') return saved
  } catch {}
  return 'system'
}

export function ThemeProvider({ children }) {
  const [preference, updatePreference] = useState(readPreference)
  const [media] = useState(() => window.matchMedia(systemQuery))
  const [systemDark, setSystemDark] = useState(() => media.matches)
  const theme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference

  useEffect(() => {
    const onSystemChange = () => setSystemDark(media.matches)
    function onStorage(event) {
      if (event.key === 'theme' || event.key === null) updatePreference(readPreference())
    }
    media.addEventListener('change', onSystemChange)
    window.addEventListener('storage', onStorage)
    onSystemChange()
    return () => {
      media.removeEventListener('change', onSystemChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [media])

  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.ground = theme
    const surface = getComputedStyle(root).getPropertyValue('--surface').trim()
    if (surface) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', surface)
  }, [theme])

  const setPreference = useCallback((value) => {
    if (!['system', 'light', 'dark'].includes(value)) return
    try {
      if (value === 'system') localStorage.removeItem('theme')
      else localStorage.setItem('theme', value)
    } catch {}
    updatePreference(value)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, preference, setPreference, isLight: theme === 'light' }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
