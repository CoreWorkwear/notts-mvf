import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { fixtureConcluded } from '../lib/format'
import { firstRow } from '../lib/embed'
import { isSquadMember } from '../lib/players'
import { logError } from '../lib/logger'

// Loads everything the Fixtures screen needs for a season. RLS does the
// eligibility gate for us: a non-eligible player simply never receives XL
// fixtures from this query. We enrich each fixture with the viewer's own
// availability, the in/maybe/out tally, and the not-replied count (derived
// from the eligible roster for that team).
export function useFixtures(seasonId) {
  const { user } = useAuth()
  const [fixtures, setFixtures] = useState([])
  const [teams, setTeams] = useState([])
  const [opponents, setOpponents] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!seasonId) return
    setLoading(true)

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
      // Eligible roster per team: approved, active squad players (and for XL
      // only the eligible). Supporters + pending players don't count.
      supabase
        .from('team_memberships')
        .select('team_id, teams(key), profiles!inner(id, active, approved, is_player, xl_eligible)'),
    ])

    const fetchErr = [fixRes, teamRes, oppRes, rosterRes].find((r) => r?.error)?.error
    if (fetchErr) logError('fetch', fetchErr.message, { hook: 'useFixtures', seasonId })

    // Build eligible-roster size per team_id.
    const rosterByTeam = {}
    for (const m of rosterRes.data ?? []) {
      const p = m.profiles
      if (!isSquadMember(p)) continue
      if (m.teams?.key === 'xl' && !p.xl_eligible) continue
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
    setLoading(false)
  }, [seasonId, user?.id])

  useEffect(() => { load() }, [load])

  // First-cut realtime: refetch when the tab regains focus (HANDOVER §7).
  // On mobile/installed PWAs the window `focus` event is unreliable, so we also
  // refetch on `visibilitychange` — this is what makes a newly-added player show
  // up in the counts when the manager flips back to Fixtures.
  useEffect(() => {
    const refresh = () => load()
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    // A push-notification availability action just committed → show the new value.
    window.addEventListener('mvf-availability-applied', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('mvf-availability-applied', refresh)
    }
  }, [load])

  // A fixture stays in Fixtures until kickoff + 4h (London). A logged result
  // moves it to Results immediately. "past" here = concluded scheduled games
  // still awaiting a result (drives the manager's "needs doing" strip).
  const upcoming = fixtures.filter((f) => !f.concluded && !f.hasResult)
  const past = fixtures.filter((f) => f.concluded && !f.hasResult && !f.postponed)

  return { fixtures, upcoming, past, teams, opponents, loading, refetch: load }
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
