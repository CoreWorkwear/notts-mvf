import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BottomNav from './BottomNav'

const h = vi.hoisted(() => ({ admin: false }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ isAdmin: h.admin }) }))

const labels = () => [...document.querySelectorAll('.nav-label')].map((n) => n.textContent)

describe('BottomNav', () => {
  test('a player gets the four core tabs, no admin clutter', () => {
    h.admin = false
    render(<MemoryRouter><BottomNav /></MemoryRouter>)
    expect(labels()).toEqual(['Fixtures', 'Results', 'Club', 'You'])
  })

  test('an admin gets a single Manage hub — not Who\'s In / Players as tabs', () => {
    h.admin = true
    render(<MemoryRouter><BottomNav /></MemoryRouter>)
    expect(labels()).toEqual(['Fixtures', 'Results', 'Club', 'Manage', 'You'])
    expect(screen.queryByText("Who's In")).not.toBeInTheDocument()
    expect(screen.queryByText('Players')).not.toBeInTheDocument()
  })
})
