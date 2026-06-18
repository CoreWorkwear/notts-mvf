import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

// §3 — the manager-view toggle. It's a COSMETIC switch: only a real admin sees it,
// and flipping it just flips the shared managerView flag (which gates admin UI).
// The server enforcement is proven separately in the RLS harness (T10).

let auth
const setManagerView = vi.fn()
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../context/SeasonContext', () => ({ useSeason: () => ({ seasons: [], seasonId: null, setSeasonId: vi.fn() }) }))
vi.mock('./ThemeToggle', () => ({ default: () => <button>theme</button> }))
vi.mock('./Crest', () => ({ default: () => <span>crest</span> }))

import Header from './Header'

const renderHeader = () => render(<MemoryRouter><Header /></MemoryRouter>)

beforeEach(() => {
  setManagerView.mockClear()
  auth = { signOut: vi.fn(), isRealAdmin: true, managerView: false, setManagerView }
})

describe('Header manager-view toggle (§3)', () => {
  test('a real admin sees the toggle; it reads "off" by default', () => {
    renderHeader()
    const btn = screen.getByRole('button', { name: /manager view/i })
    expect(btn).toHaveAttribute('aria-pressed', 'false')
  })

  test('a non-admin never sees the toggle', () => {
    auth = { ...auth, isRealAdmin: false }
    renderHeader()
    expect(screen.queryByRole('button', { name: /manager view/i })).not.toBeInTheDocument()
  })

  test('tapping it flips manager view on', async () => {
    renderHeader()
    await userEvent.click(screen.getByRole('button', { name: /manager view/i }))
    expect(setManagerView).toHaveBeenCalledWith(true)
  })

  test('when on, it reads "pressed" and tapping flips it back off', async () => {
    auth = { ...auth, managerView: true }
    renderHeader()
    const btn = screen.getByRole('button', { name: /manager view/i })
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(btn)
    expect(setManagerView).toHaveBeenCalledWith(false)
  })
})
