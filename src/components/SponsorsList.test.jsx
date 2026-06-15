import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

let state
vi.mock('../hooks/useSponsors', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useSponsors: () => state }
})

import SponsorsList from './SponsorsList'

beforeEach(() => { state = { sponsors: [], loading: false } })

describe('SponsorsList', () => {
  test('empty state when there are no active sponsors', () => {
    render(<SponsorsList />)
    expect(screen.getByText(/no sponsors listed yet/i)).toBeInTheDocument()
  })

  test('groups by tier, hides inactive, links out where there is a website', () => {
    state = { loading: false, sponsors: [
      { id: '1', name: 'CoreWorkwear', tier: 'main', active: true, logo_url: 'a.png', website: 'coreworkwear.com' },
      { id: '2', name: 'PartnerCo', tier: 'partner', active: true, logo_url: null },
      { id: '3', name: 'HiddenCo', tier: 'partner', active: false, logo_url: 'h.png' },
    ] }
    render(<SponsorsList />)
    expect(screen.getByText('Team Sponsor')).toBeInTheDocument()
    expect(screen.getByText('Club Partners')).toBeInTheDocument()
    expect(screen.getByText('CoreWorkwear')).toBeInTheDocument()
    expect(screen.getByText('PartnerCo')).toBeInTheDocument()
    expect(screen.queryByText('HiddenCo')).not.toBeInTheDocument() // inactive hidden
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://coreworkwear.com')
  })
})
