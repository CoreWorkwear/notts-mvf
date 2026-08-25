import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { fixtureConcluded } from '../lib/format'
import { firstRow } from '../lib/embed'
import { isSquadMember } from '../lib/players'
import { logError } from '../lib/logger'

// A focus/visibility refetch this soon after the last load started is skipped
// (foregrounding fires both events together). Exported for the test.
export const FOCUS_REFETCH_MIN_MS = 5000

// Loads everything the Fixtures screen needs for a season. RLS scopes the
// rows to the viewer's club (the old eligibility gate is gone — every active
// member sees every fixture). We enrich each fixture with the viewer's own
// availability, the in/maybe/out tally, and the not-replied count (derived
// from the approved active roster for that team).
export function useFixtures(seasonId) {
  const { user } = useAuth()
  const [fixtures, setFixtures] = useState([])
  const [teams, setTeams] = useState([])
  const [opponents, setOpponents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const lastLoadStart = useRef(0)

  const load = useCallback(async () => {
    // No season yet — before one resolves, or if the seasons fetch itself
    // failed. Don't sit on the "Pulling the fixtures…" loader forever: resolve
    // to an empty, non-loading state so the screen renders.
    if (!seasonId) { setFixtures([]); setLoading(false); setError(null); return }
    lastLoadStart.current = Date.now()
    setLoading(true)
    setError(null)

    try {
      const [fixRes, teamRes, oppRes, rosterRes] = await Promise.all([
        supabase
          .from('fixtures')
          .select(`
            id, match_date, kickoff, home_away, fixture_type, league_name,
            venue, address, postcode, w3w, venue_lat, venue_lng,
            season_id, team_id, opponent_id, status, pinned_image_id,
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

      const fetchErr = [fixRes, teamRes, oppRes, rosterRes].find((r) => r?.error)?.error
      if (fetchErr) logError('fetch', fetchErr.message, { hook: 'useFixtures', seasonId })

      // Build roster size per team_id.
      const rosterByTeam = {}
      for (const m of rosterRes.data ?? []) {
        if (!isSquadMember(m.profiles)) continue
        rosterByTeam[m.team_id] = (rosterByTeam[m.team_id] ?? 0) + 1
      }

      const enriched = (fixRes.data ?? []).map((f) => {
        const avail = f.availability ?? []
        const counts = { in: 0, maybe: 0, out: 0 }
        let mine = null
        for (const a of avail) {
          if (a.status in counts) counts[a.status]++
          if (a.profile_id === user?.id) mine = a.status
        }
        const replied = counts.in + counts.maybe + counts.out
        const rosterSize = rosterByTeam[f.team_id] ?? 0
        return {
          ...f,
          counts,
          myStatus: mine,
          replied,
          noReply: Math.max(0, rosterSize - replied),
          rosterSize,
          hasResult: !!firstRow(f.results),
          postponed: f.status === 'postponed',
          concluded: fixtureConcluded(f.match_date, f.kickoff),
          pinnedUrl: firstRow(f.pinned)?.url ?? null,
        }
      })

      setFixtures(enriched)
      setTeams((teamRes.data ?? []).sort((a, b) => Number(b.is_first_team) - Number(a.is_first_team)))
      setOpponents(oppRes.data ?? [])
    } catch (e) {
      // A network-level reject ("TypeError: Load failed" — seen repeatedly on
      // /fixtures in client_errors) must NOT wedge the loader on forever. Leave
      // any previously-loaded fixtures in place and surface the error so the
      // screen can offer a retry rather than hang.
      logError('fetch', e?.message ?? 'useFixtures load failed', { hook: 'useFixtures', seasonId })
      setError(e ?? new Error('load failed'))
    } finally {
      setLoading(false)
    }
  }, [seasonId, user?.id])

  useEffect(() => { load() }, [load])

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
    const onApplied = () => load()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    // A push-notification availability action just committed → show the new value.
    window.addEventListener('mvf-availability-applied', onApplied)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('mvf-availability-applied', onApplied)
    }
  }, [load])

  // Optimistically reflect the viewer's own availability tap in local state so
  // the control moves instantly; the post-write refetch reconciles with the
  // server, and the caller re-applies the previous status if the write fails.
  const applyMyStatus = useCallback((fixtureId, status) => {
    setFixtures((prev) => prev.map((f) => {
      if (f.id !== fixtureId || f.myStatus === status) return f
      const counts = { ...f.counts }
      if (f.myStatus in counts) counts[f.myStatus]--
      if (status in counts) counts[status]++
      const replied = counts.in + counts.maybe + counts.out
      return { ...f, myStatus: status, counts, replied, noReply: Math.max(0, f.rosterSize - replied) }
    }))
  }, [])

  // A fixture stays in Fixtures until kickoff + 4h (London). A logged result
  // moves it to Results immediately. "past" here = concluded scheduled games
  // still awaiting a result (drives the manager's "needs doing" strip).
  const upcoming = fixtures.filter((f) => !f.concluded && !f.hasResult)
  const past = fixtures.filter((f) => f.concluded && !f.hasResult && !f.postponed)

  return { fixtures, upcoming, past, teams, opponents, loading, error, refetch: load, applyMyStatus }
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
