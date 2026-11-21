import { fixtureMatchup } from './teams'
import { fixtureConcluded } from './format'

// Keep the most recently viewed season's public match details on this device.
// No profiles, squad lists, response counts or permissions travel with it.
const key = 'mvf:fixture-diary:v1'

export function saveDiary(owner, fixtures, season) {
  if (!owner) return
  const games = fixtures.filter(f => !f.hasResult && !f.concluded).map(f => ({
    id: f.id, title: fixtureMatchup(f), date: f.match_date, kickoff: f.kickoff,
    venue: f.venue, postponed: !!f.postponed,
  }))
  try { localStorage.setItem(key, JSON.stringify({ owner, season, savedAt: Date.now(), games })) }
  catch { /* Storage can be unavailable in private browsing. */ }
}

export function readDiary(owner) {
  if (!owner) return null
  try {
    const diary = JSON.parse(localStorage.getItem(key))
    if (diary?.owner !== owner || !Number.isFinite(diary.savedAt) || !Array.isArray(diary.games)) return null
    return { ...diary, games: diary.games.filter(f => !fixtureConcluded(f.date, f.kickoff)) }
  } catch { return null }
}

export function forgetDiary() {
  try { localStorage.removeItem(key) } catch { /* storage unavailable */ }
}
