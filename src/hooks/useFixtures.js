import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { todayISO } from '../lib/format'

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
          venue, address, w3w, season_id, team_id, opponent_id,
          team:teams(id, key, label, colour, is_first_team),
          opponent:opponents(id, name, badge_url),
          availability(profile_id, status),
          results(fixture_id)
        `)
        .eq('season_id', seasonId)
        .order('match_date', { ascending: true })
        .order('kickoff', { ascending: true }),
      supabase.from('teams').select('id, key, label, colour, is_first_team, league_name'),
      supabase.from('opponents').select('id, name, badge_url').order('name'),
      // Eligible roster per team: active members, and for XL only the eligible.
      supabase
        .from('team_memberships')
        .select('team_id, teams(key), profiles!inner(id, active, xl_eligible)'),
    ])

    // Build eligible-roster size per team_id.
    const rosterByTeam = {}
    for (const m of rosterRes.data ?? []) {
      const p = m.profiles
      if (!p?.active) continue
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
        hasResult: (f.results ?? []).length > 0,
      }
    })

    setFixtures(enriched)
    setTeams((teamRes.data ?? []).sort((a, b) => Number(b.is_first_team) - Number(a.is_first_team)))
    setOpponents(oppRes.data ?? [])
    setLoading(false)
  }, [seasonId, user?.id])

  useEffect(() => { load() }, [load])

  // First-cut realtime: refetch when the tab regains focus (HANDOVER §7).
  useEffect(() => {
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  const today = todayISO()
  const upcoming = fixtures.filter((f) => f.match_date >= today)
  const past = fixtures.filter((f) => f.match_date < today)

  return { fixtures, upcoming, past, teams, opponents, loading, refetch: load }
}

// Set (upsert) the current user's availability for a fixture. RLS enforces
// own-row + eligibility; a non-eligible player physically cannot write an XL row.
export async function setAvailability(fixtureId, profileId, status) {
  return supabase
    .from('availability')
    .upsert({ fixture_id: fixtureId, profile_id: profileId, status }, { onConflict: 'fixture_id,profile_id' })
}
