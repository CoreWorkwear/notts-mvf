import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// The toggle used to read ONLY the browser subscription — which can belong to
// a previous user on a shared phone, or have had its push_tokens row pruned
// after delivery failures. Either way it showed a lying "Notifications on ✓".
// "On" must mean: subscription AND a push_tokens row for THIS user + token.

const store = vi.hoisted(() => ({ sub: null, row: null }))
vi.mock('../lib/push', () => ({
  pushSupported: true,
  currentSubscription: () => Promise.resolve(store.sub),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
}))
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: store.row, error: null }) }) }) }),
    }),
  },
}))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))

import NotificationToggle from './NotificationToggle'

beforeEach(() => { store.sub = null; store.row = null })

describe('NotificationToggle — on-state is the server truth, not browser state', () => {
  test('a subscription with NO push_tokens row shows OFF (it cannot be reached)', async () => {
    store.sub = { endpoint: 'https://push/x' }
    store.row = null // pruned, or the sub belongs to a previous user
    render(<NotificationToggle />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /turn on match notifications/i })).toBeInTheDocument()
    )
  })

  test('a subscription WITH a matching row shows ON', async () => {
    store.sub = { endpoint: 'https://push/x' }
    store.row = { id: 'row1' }
    render(<NotificationToggle />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /notifications on/i })).toBeInTheDocument()
    )
  })
})
