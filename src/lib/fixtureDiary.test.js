import { beforeEach, expect, test } from 'vitest'
import { saveDiary, readDiary, forgetDiary } from './fixtureDiary'

const fixture = { id: 'fixture', team: { label: 'Community' }, opponent: { name: 'Town' }, home_away: 'Home',
  match_date: '2099-10-11', kickoff: '12:00', venue: 'Club pitch', availability: [{ profile_id: 'private-id' }] }

beforeEach(() => localStorage.clear())

test('keeps only matchday details for the signed-in account and replaces a previous season', () => {
  saveDiary('player', [fixture], 'Autumn')
  expect(readDiary('player')).toMatchObject({ season: 'Autumn', games: [{ title: 'Community v Town', venue: 'Club pitch' }] })
  expect(JSON.stringify(readDiary('player'))).not.toContain('private-id')
  expect(readDiary('someone-else')).toBeNull()
  saveDiary('player', [], 'Spring')
  expect(readDiary('player').games).toEqual([])
  forgetDiary()
  expect(readDiary('player')).toBeNull()
})
