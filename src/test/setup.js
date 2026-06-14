import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Unmount React trees and reset history between tests so the sheet/history
// behaviour is tested from a clean slate each time.
afterEach(() => {
  cleanup()
  // Collapse any pushState entries left by a test.
  window.history.replaceState(null, '')
})
