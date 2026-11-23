import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { fixtureConcluded } from '../lib/format'
import { firstRow } from '../lib/embed'
import { squadIdsByTeam } from '../lib/players'
import { saveDiary } from '../lib/fixtureDiary'
import { logError } from '../lib/logger'

// A focus/visibility refetch this soon after the last load started is skipped
// (foregrounding fires both events together). Exported for the test.
export const FOCUS_REFETCH_MIN_MS = 5000

// Every scalar `fixtures` column the season load selects. Exported because the
// edit form (FixtureForm) writes a WHOLE row back: a column it writes that is
// missing here arrives undefined and is saved as null, silently, on every edit.
// competition_id was missing until Oct 2026, so every kickoff or venue edit
// unlinked the game from its league. FixtureForm.test.jsx holds the two in step.
export const FIXTURE_COLUMNS = [
  'id', 'match_date', 'kickoff', 'home_away', 'fixture_type', 'league_name', 'competition_id',
  'venue', 'address', 'postcode', 'w3w', 'venue_lat', 'venue_lng',
  'season_id', 'team_id', 'opponent_id', 'status', 'pinned_image_id',
]

// One shared empty set for fixtures whose team has no squad loaded — avoids
// allocating per fixture and keeps referential equality stable.
const EMPTY_SQUAD = new Set()

// A tap can outlive its sheet or route. Share just the in-flight answers,
// scoped to the player and match, so every entry point sees the same choice.
let pendingAnswers = new Map()
const pendingSnapshot = () => pendingAnswers
function subscribePending(update) {
  window.addEventListener('mvf-answer-pending', update)
  return () => window.removeEventListener('mvf-answer-pending', update)
}
function markPending(key, status) {
  pendingAnswers = new Map(pendingAnswers)
  if (status) pendingAnswers.set(key, status)
  else pendingAnswers.delete(key)
  window.dispatchEvent(new Event('mvf-answer-pending'))
}

function withMyStatus(fixture, status) {
  if (fixture.myStatus === status) return fixture
  if (!fixture.inViewerSquad) return { ...fixture, myStatus: status }
  const counts = { ...fixture.counts }
  if (fixture.myStatus in counts) counts[fixture.myStatus]--
  if (status in counts) counts[status]++
  const replied = counts.in + counts.maybe + counts.out
  return { ...fixture, myStatus: status, counts, replied, noReply: Math.max(0, fixture.rosterSize - replied) }
}

// Loads everything the Fixtures screen needs for a season. RLS scopes the
// rows to the viewer's club (the old eligibility gate is gone — every active
// member sees every fixture). We enrich each fixture with the viewer's own
// availability, the in/maybe/out tally, and the not-replied count (derived
// from the approved active roster for that team).
export function useFixtures(seasonId, seasonLabel = '') {
  const { user } = useAuth()
  const [savedFixtures, setFixtures] = useState([])
  const pending = useSyncExternalStore(subscribePending, pendingSnapshot)
  const fixtures = useMemo(() => !pending.size ? savedFixtures : savedFixtures.map(f => {
    const choice = pending.get(`${user?.id}:${f.id}`)
    return choice ? { ...withMyStatus(f, choice), availabilityPending: true } : f
  }), [savedFixtures, pending, user?.id])
  const [teams, setTeams] = useState([])
  const [opponents, setOpponents] = useState([])
  const [loading, setLoading] = useState(true)
  // Has a load of THIS season ever completed? "loading && nothing in the list"
  // is not the same question: it is also true on every refetch of a season that
  // really is empty, and a page that swaps to its Loader on that unmounts an
  // open form. Kept per season: carried over from another one, it made a failed
  // load of this season read as an empty diary.
  const [loadedSeason, setLoadedSeason] = useState(null)
  const loaded = !!seasonId && loadedSeason === seasonId
  const [error, setError] = useState(null)
  const lastLoadStart = useRef(0)
  // Latest-wins: only the most recent load may apply its response. A slower,
  // OLDER response landing after a newer one used to overwrite it — on a phone
  // waking its radio, the foreground refetch would arrive after the post-tap
  // refetch and revert the player's In to "—" (the DB said in; the screen didn't).
  const activeRead = useRef(null)

  const load = useCallback(async () => {
    // No season yet — before one resolves, or if the seasons fetch itself
    // failed. Don't sit on the "Pulling the fixtures…" loader forever: resolve
    // to an empty, non-loading state so the screen renders.
    if (!seasonId) { activeRead.current = null; setFixtures([]); setLoading(false); setError(null); return }
    // Each read owns a distinct map. Only the latest read can update the UI.
    const commits = new Map()
    activeRead.current = commits
    const isCurrent = () => commits === activeRead.current
    lastLoadStart.current = Date.now()
    setLoading(true)
    setError(null)

    try {
      const [fixRes, teamRes, oppRes, rosterRes] = await Promise.all([
        supabase
          .from('fixtures')
          .select(`
            ${FIXTURE_COLUMNS.join(', ')},
            team:teams(id, key, label, match_name, colour, is_first_team),
            opponent:opponents(id, name, badge_url),
            pinned:media_assets(url),
            availability(profile_id, status),
            results(fixture_id)
          `)
          .eq('season_id', seasonId)
          .order('match_date', { ascending: true })
          .order('kickoff', { ascending: true }),
        supabase.from('teams').select('id, key, label, match_name, colour, is_first_team, league_name'),
        supabase.from('opponents').select('id, name, badge_url, home_venue, home_address, home_postcode').order('name'),
        // Roster per team: approved, active squad players. Supporters + pending
        // players don't count. (No eligibility gate — §1.)
        supabase
          .from('team_memberships')
          .select('team_id, profiles!inner(id, active, approved, is_player)'),
      ])

      // A response-level error (RLS, 5xx) is a FAILED load, not an empty diary:
      // throw into the catch below so previous data survives and error is set.
      const fetchErr = [fixRes, teamRes, oppRes, rosterRes].find((r) => r?.error)?.error
      if (fetchErr) throw fetchErr
      if (!isCurrent()) return // a newer load has since started — let it win

      // Roster per team_id: the approved, active players in that squad. Both
      // halves of the no-reply sum have to mean the same thing, so the squad
      // definition is shared (squadIdsByTeam) with the Who's In readers.
      const rosterByTeam = squadIdsByTeam(rosterRes.data)

      const enriched = (fixRes.data ?? []).map((f) => {
        const avail = f.availability ?? []
        const roster = rosterByTeam[f.team_id] ?? EMPTY_SQUAD
        const counts = { in: 0, maybe: 0, out: 0 }
        let mine = null
        // Only roster members count. An answer from anyone else — a player
        // since deactivated or moved squads (their row is never cascaded
        // away) — would put the hero's "N not replied" out of step with the
        // Who's In sheet, which reckons it per roster member.
        for (const a of avail) {
          if (a.profile_id === user?.id) mine = a.status
          if (!roster.has(a.profile_id)) continue
          if (a.status in counts) counts[a.status]++
        }
        const replied = counts.in + counts.maybe + counts.out
        const rosterSize = roster.size
        const row = {
          ...f,
          counts,
          myStatus: mine,
          inViewerSquad: roster.has(user?.id),
          replied,
          noReply: Math.max(0, rosterSize - replied),
          rosterSize,
          hasResult: !!firstRow(f.results),
          postponed: f.status === 'postponed',
          concluded: fixtureConcluded(f.match_date, f.kickoff),
          pinnedUrl: firstRow(f.pinned)?.url ?? null,
        }
        return commits.has(f.id) ? withMyStatus(row, commits.get(f.id)) : row
      })

      saveDiary(user?.id, enriched, seasonLabel)
      setFixtures(enriched)
      setLoadedSeason(seasonId)
      setTeams((teamRes.data ?? []).sort((a, b) => Number(b.is_first_team) - Number(a.is_first_team)))
      setOpponents(oppRes.data ?? [])
    } catch (e) {
      // A network-level reject ("TypeError: Load failed" — seen repeatedly on
      // /fixtures in client_errors) must NOT wedge the loader on forever. Leave
      // any previously-loaded fixtures in place and surface the error so the
      // screen can offer a retry rather than hang.
      logError('fetch', e ?? 'useFixtures load failed', { hook: 'useFixtures', seasonId })
      if (isCurrent()) setError(e ?? new Error('load failed'))
    } finally {
      if (isCurrent()) {
        activeRead.current = null
        setLoading(false)
      }
    }
  }, [seasonId, seasonLabel, user?.id])

  useEffect(() => {
    load()
    return () => { activeRead.current = null }
  }, [load])

  // First-cut realtime: refetch when the tab regains focus (HANDOVER §7).
  // On mobile/installed PWAs the window `focus` event is unreliable, so we also
  // refetch on `visibilitychange` — this is what makes a newly-added player show
  // up in the counts when the manager flips back to Fixtures. Foregrounding
  // fires BOTH events back-to-back (8 queries per app switch, and the fixtures
  // query is the busiest statement on the database), so a load that started in
  // the last few seconds is not repeated. The availability-applied event stays
  // unthrottled — a write just committed and must be reflected.
  useEffect(() => {
    const refresh = () => { if (Date.now() - lastLoadStart.current > FOCUS_REFETCH_MIN_MS) load() }
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    const onApplied = ({ detail }) => {
      // PushActions does not carry the committed row. Re-read it from Supabase.
      if (!detail) { load(); return }
      if (detail.profileId !== user?.id) return
      // A season read in progress may predate the write. Replay the committed
      // answer on that response without issuing another four queries.
      activeRead.current?.set(detail.fixtureId, detail.status)
      setFixtures(rows => rows.map(f => f.id === detail.fixtureId ? withMyStatus(f, detail.status) : f))
    }
    window.addEventListener('online', load)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    // A push-notification availability action just committed → show the new value.
    window.addEventListener('mvf-availability-applied', onApplied)
    return () => {
      window.removeEventListener('online', load)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('mvf-availability-applied', onApplied)
    }
  }, [load, user?.id])

  // A fixture stays in Fixtures until kickoff + 4h (London). A logged result
  // moves it to Results immediately. "past" here = concluded scheduled games
  // still awaiting a result (drives the manager's "needs doing" strip).
  const upcoming = fixtures.filter((f) => !f.concluded && !f.hasResult)
  const past = fixtures.filter((f) => f.concluded && !f.hasResult && !f.postponed)

  return { fixtures, upcoming, past, teams, opponents, loading, loaded, error, refetch: load }
}

export async function saveFixtureAnswer(fixtureId, profileId, status) {
  const key = `${profileId}:${fixtureId}`
  if (pendingAnswers.has(key)) return false
  markPending(key, status)
  const write = () => setAvailability(fixtureId, profileId, status).catch(error => ({ error }))
  try {
    let { error } = await write()
    if (error) ({ error } = await write())
    if (error) {
      logError('write', error, { op: 'setAvailability', fixtureId, status })
      return false
    }
    window.dispatchEvent(new CustomEvent('mvf-availability-applied', { detail: { fixtureId, profileId, status } }))
    return true
  } finally {
    markPending(key, null)
  }
}

// Set (upsert) the current user's availability for a fixture. RLS enforces
// own-row + eligibility; a non-eligible player physically cannot write an XL row.
export async function setAvailability(fixtureId, profileId, status) {
  return supabase
    .from('availability')
    .upsert({ fixture_id: fixtureId, profile_id: profileId, status }, { onConflict: 'fixture_id,profile_id' })
}

// Admin: pin a specific club photo to a fixture's poster (null = back to the
// random pool). RLS: fixtures write is admin-only.
export async function setPinnedImage(fixtureId, mediaId) {
  return supabase.from('fixtures').update({ pinned_image_id: mediaId }).eq('id', fixtureId)
}
