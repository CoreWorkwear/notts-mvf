import { describe, test, expect } from 'vitest'
import { buildStats, statRows, goldenBoot, leaders, sortStandings } from './stats'

const names = { p1: 'Joe Morris', p2: 'Rich King', p3: 'Adam Bell' }

// Joe: 2 XL-league goals (one assisted by Rich), Rich: 1 XL-league goal, MOTM Joe.
// Adam: 2 Community-friendly goals, MOTM Adam.
const playedFixtures = [
  {
    team: { key: 'xl' }, fixture_type: 'League', result: { motm_profile_id: 'p1' },
    goals: [
      { scorer_profile_id: 'p1' },
      { scorer_profile_id: 'p1', assist_profile_id: 'p2' },
      { scorer_profile_id: 'p2' },
    ],
  },
  {
    team: { key: 'community' }, fixture_type: 'Friendly', result: { motm_profile_id: 'p3' },
    goals: [{ scorer_profile_id: 'p3' }, { scorer_profile_id: 'p3' }],
  },
]
const appearances = [
  { profile_id: 'p1', teamKey: 'xl', isLeague: true },
  { profile_id: 'p2', teamKey: 'xl', isLeague: true },
  { profile_id: 'p3', teamKey: 'community', isLeague: false },
]

const stats = buildStats({ playedFixtures, appearances, names })

describe('stats engine', () => {
  test('splits goals by league vs friendly', () => {
    const whole = statRows(stats, 'whole')
    expect(whole.find((r) => r.id === 'p1').goals).toEqual({ l: 2, f: 0, total: 2 })
    expect(whole.find((r) => r.id === 'p3').goals).toEqual({ l: 0, f: 2, total: 2 })
  })

  test('golden boot handles ties (whole club)', () => {
    const gb = goldenBoot(statRows(stats, 'whole'))
    expect(gb.goals).toBe(2)
    expect(gb.top.map((p) => p.name)).toEqual(['Adam Bell', 'Joe Morris'])
  })

  test('scope filters to a single team', () => {
    const xl = statRows(stats, 'xl')
    expect(goldenBoot(xl).top.map((p) => p.name)).toEqual(['Joe Morris']) // Adam scored only for Community
    const community = statRows(stats, 'community')
    expect(community.map((r) => r.id)).toEqual(['p3'])
  })

  test('assist leaders key by profile_id', () => {
    const top = leaders(statRows(stats, 'whole'), 'assists', 5)
    expect(top.map((p) => `${p.name}:${p.assists.total}`)).toEqual(['Rich King:1'])
  })

  test('MOTM and appearances tally per scope', () => {
    const whole = statRows(stats, 'whole')
    expect(whole.find((r) => r.id === 'p1').motm.total).toBe(1)
    expect(whole.find((r) => r.id === 'p3').apps).toEqual({ l: 0, f: 1, total: 1 })
  })

  test('a free-typed (guest) scorer with no profile_id is excluded', () => {
    const s = buildStats({
      playedFixtures: [{ team: { key: 'xl' }, fixture_type: 'League', result: {},
        goals: [{ scorer_name: 'Some Trialist' }] }],
      appearances: [], names: {},
    })
    expect(statRows(s, 'whole')).toHaveLength(0)
  })

  test('standings sort by points, then GD, then GF', () => {
    const ordered = sortStandings([
      { id: 'a', team_name: 'Us', pts: 6, gf: 5, ga: 2, won: 2, drawn: 0, lost: 1 },
      { id: 'b', team_name: 'Them', pts: 6, gf: 4, ga: 3, won: 2, drawn: 0, lost: 1 },
      { id: 'c', team_name: 'Top', pts: 9, gf: 3, ga: 1, won: 3, drawn: 0, lost: 0 },
      { id: 'd', team_name: 'Equal', pts: 6, gf: 5, ga: 2, won: 2, drawn: 0, lost: 1 },
    ])
    expect(ordered.map((r) => r.team_name)).toEqual(['Top', 'Equal', 'Us', 'Them'])
  })
})
