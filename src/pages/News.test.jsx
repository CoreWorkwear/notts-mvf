import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// BUG: useNews exposes `error`, but the page rendered "Nothing in the diary
// yet" on a failed load. A failed first load must say so and offer a retry;
// a failed refresh with posts already on screen must keep them.

const state = vi.hoisted(() => ({ items: [], loading: false, error: null, refetch: null }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ isAdmin: true }) }))
vi.mock('../hooks/useNews', () => ({ useNews: () => ({ ...state, post: vi.fn(), remove: vi.fn() }) }))
vi.mock('../components/NewsForm', () => ({ default: ({ open }) => (open ? <div role="dialog">NEWS FORM</div> : null) }))

import News from './News'

const POST = { id: 'n1', title: 'Presentation night', body: 'Saturday at the club.', created_at: '2026-05-01T10:00:00Z', pushed: false, author: null }

beforeEach(() => {
  state.items = []
  state.loading = false
  state.error = null
  state.refetch = vi.fn()
})

describe('News — a failed load is not an empty diary', () => {
  test('first load failed → error + Try again (calls refetch), no empty state', async () => {
    state.error = { message: 'boom' }
    render(<News />)
    expect(screen.queryByText(/nothing in the diary yet/i)).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't/i)
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(state.refetch).toHaveBeenCalled()
  })

  test('a failed refresh keeps the posts on screen with a quiet status line', () => {
    state.items = [POST]
    state.error = { message: 'boom' }
    render(<News />)
    expect(screen.getByText('Presentation night')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/couldn't refresh/i)
  })

  test('a genuinely empty diary still shows the empty state', () => {
    render(<News />)
    expect(screen.getByText(/nothing in the diary yet/i)).toBeInTheDocument()
  })

  test('a refetch with posts already loaded keeps the page mounted (no Loader)', () => {
    state.items = [POST]
    state.loading = true // the hook flips this on every refetch (e.g. right after a post)
    render(<News />)
    expect(screen.getByText('Presentation night')).toBeInTheDocument()
  })
})
