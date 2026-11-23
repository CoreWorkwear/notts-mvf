import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ThemeProvider } from './ThemeContext'
import ThemeToggle from '../components/ThemeToggle'

const html = readFileSync('index.html', 'utf8')
const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)[1]
const css = readFileSync('src/styles/tokens.css', 'utf8')
// The first-paint script runs before the stylesheet. Compare its two immediate
// browser-chrome colours with the actual ground tokens used after React mounts.
const colours = {
  light: css.match(/:root\s*\{[^}]*?--surface:\s*(#[\da-f]{6});/i)[1],
  dark: css.match(/\[data-ground="dark"\]\s*\{[^}]*?--surface:\s*(#[\da-f]{6});/i)[1],
}
let system, meta, style

beforeEach(() => {
  localStorage.clear()
  system = Object.assign(new EventTarget(), { matches: false })
  vi.spyOn(window, 'matchMedia').mockReturnValue(system)
  meta = document.createElement('meta')
  meta.name = 'theme-color'
  document.head.append(meta)
  style = document.createElement('style')
  style.textContent = `:root { --surface: ${colours.light} } :root[data-ground="dark"] { --surface: ${colours.dark} }`
  document.head.append(style)
})
afterEach(() => {
  meta.remove()
  style.remove()
  delete document.documentElement.dataset.ground
  localStorage.clear()
  vi.restoreAllMocks()
})

function expectGround(value) {
  expect(document.documentElement.dataset.ground).toBe(value)
  expect(meta.content.toUpperCase()).toBe(colours[value])
}
function setDark(matches) {
  act(() => {
    system.matches = matches
    system.dispatchEvent(new Event('change'))
  })
}

test.each([
  [null, false, 'light'], [null, true, 'dark'], ['light', true, 'light'],
  ['dark', false, 'dark'], ['sepia', false, 'light'],
])('first paint resolves saved %s and system dark %s as %s', (saved, dark, expected) => {
  runInContext(bootstrap, createContext({
    document, localStorage: { getItem: () => saved }, matchMedia: () => ({ matches: dark }),
  }))
  expectGround(expected)
})
test('storage refusal still allows first paint to follow the phone', () => {
  runInContext(bootstrap, createContext({
    document, localStorage: { getItem() { throw Error('Storage disabled') } },
    matchMedia: () => ({ matches: true }),
  }))
  expectGround('dark')
})
test('system follows the phone, an override persists, and System clears it', () => {
  render(<ThemeProvider><ThemeToggle /></ThemeProvider>)
  const picker = screen.getByRole('combobox', { name: 'Appearance' })
  expect(picker).toHaveValue('system')
  expectGround('light')
  expect(localStorage.getItem('theme')).toBeNull()
  setDark(true)
  expectGround('dark')
  fireEvent.change(picker, { target: { value: 'light' } })
  expect(localStorage.getItem('theme')).toBe('light')
  setDark(false)
  setDark(true)
  expectGround('light')
  fireEvent.change(picker, { target: { value: 'system' } })
  expectGround('dark')
  expect(localStorage.getItem('theme')).toBeNull()
})
test('a valid legacy dark choice survives a light system and a reload', () => {
  localStorage.setItem('theme', 'dark')
  render(<ThemeProvider><ThemeToggle /></ThemeProvider>)
  expect(screen.getByRole('combobox', { name: 'Appearance' })).toHaveValue('dark')
  expectGround('dark')
})
