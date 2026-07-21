import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'

// The cold-start hang: if session restore rejects or never settles, the app used to
// sit on its loading splash forever (setLoading(false) only ran on the happy path).
// These lock in that startup ALWAYS releases the UI.

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
    },
    from: vi.fn(() => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null }) }) }) })),
  },
}))
vi.mock('../lib/logger', () => ({ logError: vi.fn() }))

import { supabase } from '../lib/supabase'
import { AuthProvider, useAuth } from './AuthContext'

function Probe() {
  const { loading } = useAuth()
  return <div>{loading ? 'LOADING' : 'READY'}</div>
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { vi.useRealTimers() })

describe('AuthContext startup resilience', () => {
  test('a FAILED session restore still releases the splash (no infinite hang)', async () => {
    supabase.auth.getSession.mockRejectedValue(new Error('network down'))
    render(<AuthProvider><Probe /></AuthProvider>)
    expect(screen.getByText('LOADING')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('READY')).toBeInTheDocument())
  })

  test('a session restore that NEVER settles releases after the safety timeout', async () => {
    vi.useFakeTimers()
    supabase.auth.getSession.mockReturnValue(new Promise(() => {})) // never resolves
    render(<AuthProvider><Probe /></AuthProvider>)
    expect(screen.getByText('LOADING')).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(6000) })
    expect(screen.getByText('READY')).toBeInTheDocument()
  })
})
