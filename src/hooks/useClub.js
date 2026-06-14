import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { buildStats } from '../lib/stats'
import { firstRow } from '../lib/embed'

// Loads everything the Club tab needs for a season: the manual league tables,
// the teams, and the derived stats (golden boot / leaderboards / squad table).
// Appearances are proxied from availability='in' for fixtures that were played
// (HANDOVER §3 note); goals/assists/MOTM come straight off results.
export function useClub(seasonId) {
  const [table, setTable] = useState([])
  const [teams, setTeams] = useState([])
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!seasonId) return
    setLoading(true)

    const [tblRes, teamRes, fixRes, availRes, profRes] = await Promise.all([
      supabase.from('league_tables').select('*').eq('season_id', seasonId),
      supabase.from('teams').select('id, key, label, colour, is_first_team'),
      supabase
        .from('fixtures')
        .select('id, fixture_type, team:teams(key), result:results!inner(motm_profile_id), goals(scorer_profile_id, assist_profile_id)')
        .eq('season_id', seasonId),
      supabase
        .from('availability')
        .select('profile_id, fixtures!inner(id, fixture_type, season_id, team:teams(key))')
        .eq('status', 'in')
        .eq('fixtures.season_id', seasonId),
      supabase.from('profiles').select('id, first_name, last_name'),
    ])

    const names = Object.fromEntries((profRes.data ?? []).map((p) => [p.id, `${p.first_name} ${p.last_name}`]))

    // Normalise the played fixtures (results!inner can come back as object or array).
    const played = (fixRes.data ?? []).map((f) => ({
      id: f.id,
      fixture_type: f.fixture_type,
      team: f.team,
      result: firstRow(f.result),
      goals: f.goals ?? [],
    }))
    const playedSet = new Set(played.map((f) => f.id))

    // Appearances: only count availability='in' on fixtures that were actually played.
    const appearances = (availRes.data ?? [])
      .filter((a) => a.fixtures && playedSet.has(a.fixtures.id))
      .map((a) => ({
        profile_id: a.profile_id,
        teamKey: a.fixtures.team?.key === 'community' ? 'community' : 'xl',
        isLeague: a.fixtures.fixture_type === 'League',
      }))

    setStats(buildStats({ playedFixtures: played, appearances, names }))
    setTable(tblRes.data ?? [])
    setTeams((teamRes.data ?? []).sort((a, b) => Number(b.is_first_team) - Number(a.is_first_team)))
    setLoading(false)
  }, [seasonId])

  useEffect(() => { load() }, [load])

  return { table, teams, stats, loading, refetch: load }
}
