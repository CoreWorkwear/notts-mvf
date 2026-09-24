import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// The one page whose job is to reveal failures must not hide its own: a
// failed load used to render "All quiet 🟢". It also groups repeats so 40
// rows of the same "Load failed" read as one line with a count.
const store = vi.hoisted(() => ({ rows: [], error: null, deleted: 0 }))
vi.mock('../lib/supabase', () => {
  const q = {
    select: () => q, order: () => q, limit: () => q, neq: () => q,
    delete: () => { store.deleted++; return q },
    then: (res, rej) => Promise.resolve({ data: store.error ? null : store.rows, error: store.error }).then(res, rej),
  }
  return { supabase: { from: () => q } }
})
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-admin' } }) }))
vi.mock('../lib/push', () => ({ pushSupported: false, currentSubscription: vi.fn() }))
vi.mock('../lib/logger', async (orig) => ({ ...(await orig()), logError: vi.fn() }))

import Diagnostics from './Diagnostics'

const ROW = (over) => ({
  id: Math.random().toString(36).slice(2), created_at: '2026-09-24T10:00:00Z', kind: 'fetch', message: 'Load failed',
  url: '/fixtures', user_agent: 'Mozilla/5.0 (iPhone) Safari/604.1',
  context: { build: '0.1.0+abc1234', breadcrumbs: [{ t: 120, c: 'nav', m: '/fixtures' }, { t: 900, c: 'fetch', m: 'GET /rest/v1/fixtures → 500' }] },
  ...over,
})

beforeEach(() => { store.rows = []; store.error = null; store.deleted = 0 })

describe('Diagnostics', () => {
  test('a FAILED load is reported with a retry — never "All quiet"', async () => {
    store.error = { message: 'permission denied', code: '42501' }
    render(<Diagnostics />)
    expect(await screen.findByText(/couldn't load the log/i)).toBeInTheDocument()
    expect(screen.queryByText(/all quiet/i)).toBeNull()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  test('an empty log really is all quiet', async () => {
    render(<Diagnostics />)
    expect(await screen.findByText(/all quiet/i)).toBeInTheDocument()
  })

  test('repeats collapse into one card with a count; tapping it shows each occurrence with its breadcrumbs and build', async () => {
    store.rows = [ROW({ created_at: '2026-09-24T12:00:00Z' }), ROW({ created_at: '2026-09-24T11:00:00Z', url: '/results' }), ROW({ created_at: '2026-09-24T10:00:00Z' })]
    render(<Diagnostics />)
    const head = await screen.findByRole('button', { expanded: false })
    expect(head).toHaveTextContent('×3')
    expect(head).toHaveTextContent('Load failed')
    expect(head).toHaveTextContent('build 0.1.0+abc1234')

    await userEvent.click(head)
    const crumbs = await screen.findAllByTestId('breadcrumbs')
    expect(crumbs).toHaveLength(3)
    expect(crumbs[0]).toHaveTextContent('GET /rest/v1/fixtures → 500')
    expect(screen.getAllByText(/iPhone · Safari/)).not.toHaveLength(0)
  })

  test('kind chips filter the list', async () => {
    store.rows = [ROW(), ROW({ kind: 'render', message: 'x is not a function' })]
    render(<Diagnostics />)
    await screen.findByText('Load failed')
    await userEvent.click(screen.getByRole('button', { name: /^render · 1/ }))
    expect(screen.queryByText('Load failed')).toBeNull()
    expect(screen.getByText('x is not a function')).toBeInTheDocument()
  })

  test('shows this device: build, connectivity and the session breadcrumbs', async () => {
    render(<Diagnostics />)
    const panel = await screen.findByTestId('device-panel')
    expect(panel).toHaveTextContent(/build/)
    expect(panel).toHaveTextContent(/online/)
    expect(panel).toHaveTextContent(/notifications/)
  })

  test('Clear surfaces a refused delete instead of silently reloading', async () => {
    store.rows = [ROW()]
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Diagnostics />)
    await screen.findByText('Load failed')
    store.error = { message: 'permission denied', code: '42501' }
    await userEvent.click(screen.getByRole('button', { name: /clear/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not allowed/i))
    expect(store.deleted).toBe(1)
  })
})
