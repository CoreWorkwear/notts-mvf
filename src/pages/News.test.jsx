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
  state.loaded = undefined // older tests model the hook without it
  state.error = null
  state.refetch = vi.fn()
})

describe('News — a failed load is not an empty diary', () => {
  test('announcements keep authored paragraphs and the London publication date', () => {
    state.items = [{ ...POST, created_at: '2026-05-01T23:30:00Z', body: 'Doors at seven.\n\nBring your family.' }]
    render(<News />)
    const article = screen.getByRole('article', { name: 'Presentation night' })
    expect(article.querySelector('time')).toHaveTextContent(/2 May/)
    expect(article.querySelector('time')).toHaveAttribute('datetime', state.items[0].created_at)
    expect(screen.getByText('Bring your family.', { selector: 'p' })).toBeVisible()
  })

  test('first load failed → error + Try again (calls refetch), no empty state', async () => {
    state.error = { message: 'boom' }
    render(<News />)
    expect(screen.queryByText(/no club news/i)).toBeNull()
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
    expect(screen.getByText(/no club news/i)).toBeInTheDocument()
  })

  test('a refetch with posts already loaded keeps the page mounted (no Loader)', () => {
    state.items = [POST]
    state.loading = true // the hook flips this on every refetch (e.g. right after a post)
    render(<News />)
    expect(screen.getByText('Presentation night')).toBeInTheDocument()
  })
})

// The first-ever post: the list is empty, so "loading && no items" swapped the
// page for the Loader mid-post and unmounted the compose sheet, losing its
// "the push didn't go out" notice.
describe('News — an empty list does not go back to the Loader on a refetch', () => {
  test('with one load already done, the page and the open compose sheet stay', async () => {
    state.loaded = true
    const { rerender } = render(<News />)
    await userEvent.click(screen.getByRole('button', { name: /post news/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    state.loading = true // the hook flips this mid-post
    rerender(<News />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByText(/loading news/i)).toBeNull()
  })
  test('the very first load still gets the Loader', () => {
    state.loaded = false
    state.loading = true
    render(<News />)
    expect(screen.getByText(/loading news/i)).toBeInTheDocument()
  })
})
