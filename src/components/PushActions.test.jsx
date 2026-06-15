import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

// Capture setAvailability calls; assert each notification action persists ITS OWN
// status (the bug report: "I'm in" must write 'in', never 'maybe').
const setAvailability = vi.hoisted(() => vi.fn().mockResolvedValue({ error: null }))
vi.mock('../hooks/useFixtures', () => ({ setAvailability }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))

import PushActions from './PushActions'

// Minimal serviceWorker stub (jsdom has none) so the 'message' path works.
let swListeners = []
beforeEach(() => {
  setAvailability.mockClear()
  swListeners = []
  navigator.serviceWorker = {
    addEventListener: (t, fn) => { if (t === 'message') swListeners.push(fn) },
    removeEventListener: (t, fn) => { swListeners = swListeners.filter((f) => f !== fn) },
  }
  window.history.replaceState(null, '', '/fixtures')
})
afterEach(() => { delete navigator.serviceWorker })

describe('PushActions — notification action → availability status', () => {
  test.each(['in', 'maybe', 'out'])('the cold-open URL path applies %s exactly', async (status) => {
    window.history.replaceState(null, '', `/fixtures?mvf_fixture=f1&mvf_avail=${status}`)
    render(<PushActions />)
    await waitFor(() => expect(setAvailability).toHaveBeenCalledWith('f1', 'u1', status))
    // and only that status — no off-by-one to a neighbour
    expect(setAvailability).toHaveBeenCalledTimes(1)
  })

  test.each(['in', 'maybe', 'out'])('the app-open postMessage path applies %s exactly', async (status) => {
    render(<PushActions />)
    swListeners.forEach((fn) => fn({ data: { type: 'mvf-avail', fixtureId: 'f2', status } }))
    await waitFor(() => expect(setAvailability).toHaveBeenCalledWith('f2', 'u1', status))
    expect(setAvailability).toHaveBeenCalledTimes(1)
  })

  test('ignores an unknown action', async () => {
    render(<PushActions />)
    swListeners.forEach((fn) => fn({ data: { type: 'mvf-avail', fixtureId: 'f3', status: 'bogus' } }))
    expect(setAvailability).not.toHaveBeenCalled()
  })
})
