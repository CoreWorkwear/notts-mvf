import { describe, test, expect } from 'vitest'
import { squadByPosition, primaryPosition, positionDepth, depthChartStarters } from './squadList'

const make = (over) => ({ id: over.id, first_name: over.first_name ?? 'A', last_name: over.last_name ?? 'Z', active: true, approved: true, is_player: true, positions: [], preferred: null, ...over })

describe('squadByPosition (§4.1)', () => {
  test('groups by primary position in football order: GK, DEF, MID, FWD', () => {
    const players = [
      make({ id: 'f', preferred: 'ST' }),
      make({ id: 'g', preferred: 'GK' }),
      make({ id: 'm', preferred: 'CM' }),
      make({ id: 'd', preferred: 'CB' }),
    ]
    expect(squadByPosition(players).map((g) => g.key)).toEqual(['GK', 'DEF', 'MID', 'FWD'])
  })

  test('falls back to the first listed position when no preferred', () => {
    expect(primaryPosition({ positions: ['LB', 'CB'], preferred: null })).toBe('LB')
    const groups = squadByPosition([make({ id: 'x', preferred: null, positions: ['LB'] })])
    expect(groups[0].key).toBe('DEF')
  })

  test('excludes supporters, pending and inactive players', () => {
    const players = [
      make({ id: 'ok', preferred: 'GK' }),
      make({ id: 'sup', preferred: 'GK', is_player: false }),
      make({ id: 'pend', preferred: 'GK', approved: false }),
      make({ id: 'gone', preferred: 'GK', active: false }),
    ]
    const all = squadByPosition(players).flatMap((g) => g.players.map((p) => p.id))
    expect(all).toEqual(['ok'])
  })

  test('a player with no recognised position lands in a trailing "Squad" group', () => {
    const groups = squadByPosition([make({ id: 'g', preferred: 'GK' }), make({ id: 'n', preferred: null, positions: [] })])
    expect(groups.at(-1)).toMatchObject({ key: 'NA', label: 'Squad' })
    expect(groups.at(-1).players.map((p) => p.id)).toEqual(['n'])
  })

  test('empty position groups are dropped (only non-empty shown)', () => {
    const groups = squadByPosition([make({ id: 'g', preferred: 'GK' })])
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('GK')
  })

  test('within a group, sorts by position rank then surname', () => {
    const players = [
      make({ id: 'lb', preferred: 'LB', last_name: 'Adams' }),
      make({ id: 'cb2', preferred: 'CB', last_name: 'Young' }),
      make({ id: 'cb1', preferred: 'CB', last_name: 'Brown' }),
    ]
    // CB rank < LB rank; within CB, Brown before Young.
    expect(squadByPosition(players)[0].players.map((p) => p.id)).toEqual(['cb1', 'cb2', 'lb'])
  })
})

describe('positionDepth + depthChartStarters (§4.2)', () => {
  test('depth lists preferred-for-the-position first, then coverers, by surname', () => {
    const players = [
      make({ id: 'cover', preferred: 'RB', positions: ['RB', 'CB'], last_name: 'Cover' }),
      make({ id: 'pref2', preferred: 'CB', positions: ['CB'], last_name: 'Young' }),
      make({ id: 'pref1', preferred: 'CB', positions: ['CB'], last_name: 'Brown' }),
    ]
    const depth = positionDepth(players, 'CB')
    expect(depth.map((p) => p.id)).toEqual(['pref1', 'pref2', 'cover'])
    expect(depth.map((p) => p.isPreferred)).toEqual([true, true, false])
  })

  test('excludes non-squad players from depth', () => {
    const players = [make({ id: 'ok', preferred: 'GK' }), make({ id: 'sup', preferred: 'GK', is_player: false })]
    expect(positionDepth(players, 'GK').map((p) => p.id)).toEqual(['ok'])
  })

  test('depthChartStarters deals depth across duplicate slots and never repeats a player', () => {
    const players = [
      make({ id: 'cbA', preferred: 'CB', positions: ['CB'], last_name: 'Allen' }),
      make({ id: 'cbB', preferred: 'CB', positions: ['CB'], last_name: 'Best' }),
      make({ id: 'gk', preferred: 'GK', positions: ['GK'] }),
    ]
    const starters = depthChartStarters(players, '4-3-3') // GK + LB,CB,CB,RB + ...
    const ids = Object.values(starters)
    // The two CB slots get the two different CBs; the GK slot gets the keeper.
    expect(ids.filter((id) => id === 'cbA')).toHaveLength(1)
    expect(ids.filter((id) => id === 'cbB')).toHaveLength(1)
    expect(ids).toContain('gk')
    // No player placed in two slots.
    expect(new Set(ids).size).toBe(ids.length)
  })
})
