import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fixtureConcluded } from '../lib/format'
import { firstRow } from '../lib/embed'
import { logError } from '../lib/logger'

// Results data for a season. We resolve scorer/assist/MOTM display names from
// the squad map client-side (keyed by profile_id, free-typed name as fallback)
// — robust, and exactly the data-integrity rule from HANDOVER §3.
export function useResults(seasonId) {
  const [fixtures, setFixtures] = useState([])
  const [squad, setSquad] = useState([])         // [{id, name, first, active}] — active players (the picker)
  const [everyone, setEveryone] = useState([])   // same shape, inactive included (resolves past contributors)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Latest wins: a slower, older load (last season's, say) must not overwrite
  // the newer one. Each load takes a ticket; a stale ticket sets nothing.
  const reqRef = useRef(0)
  const activeSeason = useRef(seasonId)
  activeSeason.current = seasonId

  const load = useCallback(async () => {
    if (activeSeason.current !== seasonId) return
    const id = ++reqRef.current
    const fresh = () => id === reqRef.current
    // No season yet (or the seasons fetch failed): resolve to an empty,
    // non-loading state — don't sit on "Fetching the results…" forever.
    if (!seasonId) { setFixtures([]); setSquad([]); setEveryone([]); setLoading(false); setError(null); return }
    setLoading(true)
    setError(null)

    try {
      const [fixRes, sqRes] = await Promise.all([
        supabase
          .from('fixtures')
          .select(`
            id, match_date, kickoff, home_away, fixture_type, league_name, venue, team_id, status,
            team:teams(id, key, label, match_name, colour),
            opponent:opponents(id, name, badge_url),
            pinned:media_assets(url),
            result:results(ht_us, ht_them, us, them, motm_profile_id, motm_name, motm_photo_url),
            goals(id, minute, scorer_profile_id, scorer_name, assist_profile_id, assist_name)
          `)
          .eq('season_id', seasonId)
          .order('match_date', { ascending: false })
          .order('kickoff', { ascending: false }),
        // EVERY club profile (RLS scopes to the club), inactive included: removing
        // a player is a soft delete precisely so results history survives, and a
        // since-removed scorer must still resolve by id. The picker is active-only.
        supabase.from('profiles').select('id, first_name, last_name, active'),
      ])
      if (!fresh()) return

      // Failed load ≠ "no games played": throw so the catch keeps data + error.
      const fetchErr = [fixRes, sqRes].find((r) => r?.error)?.error
      if (fetchErr) throw fetchErr

      const all = (sqRes.data ?? []).map((p) => ({
        id: p.id,
        name: `${p.first_name} ${p.last_name}`,
        first: p.first_name,
        active: p.active !== false,
      }))
      const squadById = Object.fromEntries(all.map((p) => [p.id, p.name]))

      const fixtures = (fixRes.data ?? []).map((f) => ({
        ...f,
        result: firstRow(f.result),
        goals: (f.goals ?? []).slice().sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999)),
        pinnedUrl: firstRow(f.pinned)?.url ?? null,
        squadById,
      }))

      setFixtures(fixtures)
      setSquad(all.filter((p) => p.active))
      setEveryone(all)
    } catch (e) {
      if (!fresh()) return
      logError('fetch', e ?? 'useResults load failed', { hook: 'useResults', seasonId })
      setError(e ?? new Error('load failed'))
    } finally {
      if (fresh()) setLoading(false)
    }
  }, [seasonId])

  useEffect(() => { load() }, [load])

  // Keep the server's match-date/kick-off order as a game moves between groups.
  // A confirmed score is available even when the subsequent read is slow.
  const applySavedResult = useCallback(({ id, result, goals }) => {
    if (activeSeason.current !== seasonId) return
    const byMinute = [...goals].sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999))
    setFixtures(current => current.map(f => f.id === id ? { ...f, result, goals: byMinute } : f))
  }, [seasonId])

  const { played, needsResult, postponed } = useMemo(() => {
    const played = [], needsResult = [], postponed = []
    for (const f of fixtures) {
      if (f.result) played.push(f)
      else if (fixtureConcluded(f.match_date, f.kickoff)) {
        if (f.status === 'postponed') postponed.push(f)
        else needsResult.push(f)
      }
    }
    return { played, needsResult, postponed }
  }, [fixtures])
  return { played, needsResult, postponed, squad, everyone, loading, error, refetch: load, applySavedResult }
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
