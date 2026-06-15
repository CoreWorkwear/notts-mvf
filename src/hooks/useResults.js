import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fixtureConcluded } from '../lib/format'
import { firstRow } from '../lib/embed'

// Results data for a season. We resolve scorer/assist/MOTM display names from
// the squad map client-side (keyed by profile_id, free-typed name as fallback)
// — robust, and exactly the data-integrity rule from HANDOVER §3.
export function useResults(seasonId) {
  const [played, setPlayed] = useState([])
  const [needsResult, setNeedsResult] = useState([])
  const [postponed, setPostponed] = useState([]) // concluded P-P games, archived
  const [squad, setSquad] = useState([])      // [{id, name, first}]
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!seasonId) return
    setLoading(true)

    const [fixRes, sqRes] = await Promise.all([
      supabase
        .from('fixtures')
        .select(`
          id, match_date, kickoff, home_away, fixture_type, league_name, venue, team_id, status,
          team:teams(id, key, label, match_name, colour),
          opponent:opponents(id, name, badge_url),
          pinned:media_assets(url),
          result:results(ht_us, ht_them, us, them, motm_profile_id, motm_name),
          goals(id, minute, scorer_profile_id, scorer_name, assist_profile_id, assist_name)
        `)
        .eq('season_id', seasonId)
        .order('match_date', { ascending: false }),
      supabase.from('profiles').select('id, first_name, last_name').eq('active', true),
    ])

    const squadList = (sqRes.data ?? []).map((p) => ({
      id: p.id,
      name: `${p.first_name} ${p.last_name}`,
      first: p.first_name,
    }))
    const squadById = Object.fromEntries(squadList.map((p) => [p.id, p.name]))

    const all = (fixRes.data ?? []).map((f) => ({
      ...f,
      result: firstRow(f.result),
      goals: (f.goals ?? []).slice().sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999)),
      pinnedUrl: firstRow(f.pinned)?.url ?? null,
      squadById,
    }))

    const concluded = (f) => fixtureConcluded(f.match_date, f.kickoff)
    setPlayed(all.filter((f) => f.result))
    setNeedsResult(all.filter((f) => !f.result && f.status !== 'postponed' && concluded(f)))
    setPostponed(all.filter((f) => !f.result && f.status === 'postponed' && concluded(f)))
    setSquad(squadList)
    setLoading(false)
  }, [seasonId])

  useEffect(() => { load() }, [load])

  return { played, needsResult, postponed, squad, loading, refetch: load }
}

// W / D / L from our perspective.
export function outcome(result) {
  if (!result) return null
  if (result.us > result.them) return 'W'
  if (result.us < result.them) return 'L'
  return 'D'
}

// Resolve a contributor's display name: squad member by id, else free-typed.
export function resolveName(squadById, profileId, freeName) {
  if (profileId && squadById?.[profileId]) return squadById[profileId]
  return freeName || null
}
