import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// BUG: useSponsors exposes `error`, but the page rendered "None yet." under
// every tier on a failed load. A failed first load must say so and offer a
// retry; a failed refresh with sponsors already on screen must keep them.

const state = vi.hoisted(() => ({ sponsors: [], loading: false, error: null, refetch: null }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ club: null }) })) // Loader → Crest reads it
vi.mock('../hooks/useSponsors', () => ({ useSponsors: () => ({ ...state, save: vi.fn(), remove: vi.fn() }) }))
vi.mock('../components/SponsorForm', () => ({
  SPONSOR_TIERS: [{ key: 'main', label: 'Main sponsor' }, { key: 'kit', label: 'Kit sponsor' }],
  default: ({ open }) => (open ? <div role="dialog">SPONSOR FORM</div> : null),
}))

import Sponsors from './Sponsors'

const ACME = { id: 's1', name: 'Acme Scaffolding', tier: 'main', active: true, logo_url: null, website: null }

beforeEach(() => {
  state.sponsors = []
  state.loading = false
  state.error = null
  state.refetch = vi.fn()
})

describe('Sponsors — a failed load is not "None yet."', () => {
  test('first load failed → error + Try again (calls refetch), no per-tier empty lines', async () => {
    state.error = { message: 'boom' }
    render(<Sponsors />)
    expect(screen.queryByText(/none yet/i)).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't/i)
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(state.refetch).toHaveBeenCalled()
  })

  test('a failed refresh keeps the sponsors on screen with a quiet status line', () => {
    state.sponsors = [ACME]
    state.error = { message: 'boom' }
    render(<Sponsors />)
    expect(screen.getByText('Acme Scaffolding')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/couldn't refresh/i)
  })

  test('genuinely no sponsors still shows "None yet." per tier', () => {
    render(<Sponsors />)
    expect(screen.getAllByText(/none yet/i)).toHaveLength(2)
  })

  test('a refetch with sponsors already loaded keeps the page mounted (no Loader)', () => {
    state.sponsors = [ACME]
    state.loading = true
    render(<Sponsors />)
    expect(screen.getByText('Acme Scaffolding')).toBeInTheDocument()
  })
})
