import { describe, test, expect } from 'vitest'
import { teamMatchName, fixtureMatchup } from './teams'

describe('teamMatchName', () => {
  test('prefers the competitive match name, falls back to the label', () => {
    expect(teamMatchName({ match_name: 'Nottingham', label: 'First Team' })).toBe('Nottingham')
    expect(teamMatchName({ label: 'Community' })).toBe('Community')
    expect(teamMatchName({ match_name: '', label: 'Community' })).toBe('Community')
    expect(teamMatchName(null)).toBe('')
  })
})

describe('fixtureMatchup', () => {
  const team = { match_name: 'Nottingham', label: 'First Team' }
  test('home: us v them', () => {
    expect(fixtureMatchup({ team, opponent: { name: 'Boston' }, home_away: 'Home' })).toBe('Nottingham v Boston')
  })
  test('away: them v us', () => {
    expect(fixtureMatchup({ team, opponent: { name: 'Boston' }, home_away: 'Away' })).toBe('Boston v Nottingham')
  })
  test('community falls back to its label', () => {
    expect(fixtureMatchup({ team: { label: 'Community' }, opponent: { name: 'Long Eaton' }, home_away: 'Home' })).toBe('Community v Long Eaton')
  })
})
