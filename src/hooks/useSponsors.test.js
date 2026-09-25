import { describe, test, expect } from 'vitest'
import { sponsorWebsite, byTier } from './useSponsors'

// sponsor.website is the one admin-typed URL the app renders as an <a href>
// rather than an <img src>, and migration 0037 deliberately leaves it
// unconstrained at the DB (the live values are stored scheme-less, and it
// points at a real external site). That makes THIS function the gate: it must
// never hand a non-http(s) scheme to the href, whatever is in the column.
describe('sponsorWebsite — a dangerous scheme can never reach the href', () => {
  test('passes an http(s) URL through, whatever the case', () => {
    expect(sponsorWebsite('https://coreworkwear.co.uk')).toBe('https://coreworkwear.co.uk')
    expect(sponsorWebsite('http://example.com/a?b=1')).toBe('http://example.com/a?b=1')
    expect(sponsorWebsite('HTTPS://EXAMPLE.COM')).toBe('HTTPS://EXAMPLE.COM')
  })

  test('a scheme-less entry (how the live rows are stored) gains https://', () => {
    expect(sponsorWebsite('coreworkwear.co.uk')).toBe('https://coreworkwear.co.uk')
    expect(sponsorWebsite('www.example.com/page')).toBe('https://www.example.com/page')
  })

  test('javascript:, data: and vbscript: are defused, not passed through', () => {
    for (const hostile of [
      'javascript:alert(document.cookie)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ]) {
      const out = sponsorWebsite(hostile)
      expect(out.startsWith('https://')).toBe(true)
      expect(out.toLowerCase().startsWith('javascript:')).toBe(false)
      expect(out.toLowerCase().startsWith('data:')).toBe(false)
    }
  })

  test('nothing in, nothing out — no href is rendered at all', () => {
    expect(sponsorWebsite(null)).toBeNull()
    expect(sponsorWebsite('')).toBeNull()
    expect(sponsorWebsite(undefined)).toBeNull()
  })
})

describe('byTier', () => {
  test('only active sponsors of that tier that actually have a logo', () => {
    const s = [
      { tier: 'main', active: true, logo_url: 'a' },
      { tier: 'main', active: false, logo_url: 'b' },
      { tier: 'main', active: true, logo_url: null },
      { tier: 'kit', active: true, logo_url: 'c' },
    ]
    expect(byTier(s, 'main')).toEqual([{ tier: 'main', active: true, logo_url: 'a' }])
    expect(byTier(null, 'main')).toEqual([])
  })
})
