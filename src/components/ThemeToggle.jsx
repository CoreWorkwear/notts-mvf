import { useTheme } from '../context/ThemeContext'
import { IconSun, IconMoon } from './Icons'

export default function ThemeToggle() {
  const { preference, setPreference, isLight } = useTheme()
  return (
    <label className="appearance-picker">
      <span aria-hidden="true">{isLight ? <IconSun /> : <IconMoon />}</span>
      <select aria-label="Appearance" value={preference} onChange={event => setPreference(event.target.value)}>
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  )
}
