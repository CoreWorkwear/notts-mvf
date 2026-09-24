import { describe, test, expect } from 'vitest'
import { activeRoster, statusMap } from './roster.js'

// Finding B — send-push's profileIds path used to skip this gate entirely; the
// fixture path and run-reminders each had their own copy. One source now.
describe('activeRoster', () => {
  test('keeps only approved, active players; drops pending, inactive and supporters', () => {
    const members = [
      { profile_id: 'ok', profiles: { active: true, approved: true, is_player: true } },
      { profile_id: 'pending', profiles: { active: true, approved: false, is_player: true } },
      { profile_id: 'gone', profiles: { active: false, approved: true, is_player: true } },
      { profile_id: 'fan', profiles: { active: true, approved: true, is_player: false } },
      { profile_id: 'orphan', profiles: null },
      null,
    ]
    expect(activeRoster(members)).toEqual(['ok'])
    expect(activeRoster(null)).toEqual([])
  })
})

describe('statusMap', () => {
  test('availability rows → { profile_id: status }, ignoring rows without an id', () => {
    expect(statusMap([{ profile_id: 'a', status: 'in' }, { profile_id: null, status: 'out' }, { profile_id: 'b', status: 'maybe' }]))
      .toEqual({ a: 'in', b: 'maybe' })
    expect(statusMap(undefined)).toEqual({})
  })
})
