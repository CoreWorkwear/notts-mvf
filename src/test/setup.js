import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom has no matchMedia; Framer Motion's useReducedMotion reads it. Default to
// "no preference" so motion hooks work under test.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })
}

// Unmount React trees and reset history between tests so the sheet/history
// behaviour is tested from a clean slate each time.
afterEach(() => {
  cleanup()
  // Collapse any pushState entries left by a test.
  window.history.replaceState(null, '')
})
