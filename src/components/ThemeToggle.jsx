import { useTheme } from '../context/ThemeContext'
import { IconSun, IconMoon } from './Icons'

// Compact theme switch for the header. Shows the icon of the theme you'd switch TO.
export default function ThemeToggle() {
  const { isLight, toggle } = useTheme()
  return (
    <button
      className="nav-item"
      style={{ flex: 'none', color: 'var(--bone-mute)' }}
      onClick={toggle}
      aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      title={isLight ? 'Dark mode' : 'Light mode'}
    >
      {isLight ? <IconMoon /> : <IconSun />}
    </button>
  )
}
