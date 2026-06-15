import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

let state
vi.mock('../hooks/useSponsors', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useSponsors: () => state }
})

import SponsorStrip from './SponsorStrip'
import { byTier } from '../hooks/useSponsors'

beforeEach(() => { state = { sponsors: [] } })

describe('byTier', () => {
  const sponsors = [
    { id: '1', name: 'Main A', tier: 'main', active: true, logo_url: 'a.png' },
    { id: '2', name: 'Main hidden', tier: 'main', active: false, logo_url: 'b.png' },
    { id: '3', name: 'Main no-logo', tier: 'main', active: true, logo_url: null },
    { id: '4', name: 'Kit A', tier: 'kit', active: true, logo_url: 'k.png' },
  ]
  test('keeps active, logo-bearing sponsors of that tier', () => {
    expect(byTier(sponsors, 'main').map((s) => s.name)).toEqual(['Main A'])
    expect(byTier(sponsors, 'kit').map((s) => s.name)).toEqual(['Kit A'])
  })
})

describe('SponsorStrip', () => {
  test('renders nothing without sponsors', () => {
    const { container } = render(<SponsorStrip />)
    expect(container.firstChild).toBeNull()
  })

  test('shows the main sponsor prominently and the kit sponsor beneath', () => {
    state = { sponsors: [
      { id: '1', name: 'CoreWorkwear', tier: 'main', active: true, logo_url: 'core.png', website: 'coreworkwear.com' },
      { id: '2', name: 'KitCo', tier: 'kit', active: true, logo_url: 'kit.png' },
    ] }
    render(<SponsorStrip />)
    expect(screen.getByText(/proudly sponsored by/i)).toBeInTheDocument()
    expect(screen.getByText(/kit sponsor/i)).toBeInTheDocument()
    // main sponsor links out to its (https-normalised) website
    expect(screen.getByRole('link', { name: 'CoreWorkwear' })).toHaveAttribute('href', 'https://coreworkwear.com')
    expect(screen.getByAltText('KitCo')).toBeInTheDocument()
  })
})
