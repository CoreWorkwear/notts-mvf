import { describe, test, expect } from 'vitest'
import { teamLabel, teamMatchName, fixtureMatchup, matchupScore, halfTimeScore } from './teams'

describe('club squad names', () => {
  test.each(['XL', 'XL 11s', 'First Team', '1st Team'])('shows 1st Team for the stored label %s', (label) => {
    expect(teamLabel({ key: 'xl', label, match_name: 'Nottingham' })).toBe('1st Team')
    expect(teamMatchName({ key: 'xl', label, match_name: 'Nottingham' })).toBe('Nottingham')
    expect(teamMatchName({ label })).toBe('1st Team')
  })

  test('keeps Community and unrelated team names intact', () => {
    expect(teamLabel({ key: 'community', label: 'Community' })).toBe('Community')
    expect(teamLabel({ key: 'away', label: 'Carlton XL' })).toBe('Carlton XL')
  })
})

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

// The Results strips name the home side first and used to print the score
// us–them regardless, so every away result read backwards: an away 0–4 defeat
// showed as "Bilborough v Notts MvF · 0–4" beside an L.
describe('matchupScore', () => {
  const result = { us: 0, them: 4 }
  test('home: our goals first, matching "us v them"', () => {
    expect(matchupScore({ home_away: 'Home', result })).toBe('0–4')
  })
  test('away: their goals first, matching "them v us"', () => {
    expect(matchupScore({ home_away: 'Away', result })).toBe('4–0')
  })
  test('reads in the same order as fixtureMatchup, whichever way round', () => {
    const team = { match_name: 'Notts MvF' }
    for (const home_away of ['Home', 'Away']) {
      const f = { team, opponent: { name: 'Bilborough' }, home_away, result: { us: 1, them: 3 } }
      const [first] = fixtureMatchup(f).split(' v ')
      const [firstGoals] = matchupScore(f).split('–')
      expect(firstGoals).toBe(first === 'Notts MvF' ? '1' : '3')
    }
  })
  test('no result yet: nothing to print', () => {
    expect(matchupScore({ home_away: 'Home', result: null })).toBe('')
    expect(matchupScore(null)).toBe('')
  })
})

describe('halfTimeScore', () => {
  test('a recorded half time reads us–them', () => {
    expect(halfTimeScore({ ht_us: 1, ht_them: 0 })).toBe('1–0')
    expect(halfTimeScore({ ht_us: 0, ht_them: 0 })).toBe('0–0') // a real nil-nil at the break
  })
  test('no half time recorded: nothing to show', () => {
    expect(halfTimeScore({ ht_us: null, ht_them: null })).toBeNull()
    expect(halfTimeScore({ us: 2, them: 1 })).toBeNull()
    expect(halfTimeScore(null)).toBeNull()
  })
})
