import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { rowsToState } from '../lib/lineup'
import { squadIds } from '../lib/players'
import { hasKickedOff } from '../lib/format'
import { logError } from '../lib/logger'

const EMPTY = { formation: '4-4-2', starters: {}, subs: [] }

// Line-up for one fixture: the saved selection (formation + starters + subs) and
// the pool of players to pick from. Before kickoff that is the squad members who
// marked themselves in / maybe. From kickoff it is the WHOLE squad for that
// team: answers are shut by then with no admin path (0034), so the in/maybe
// rule left no way to field a player who turned up unannounced, and he got no
// appearance (useClub counts appearances from lineups).
// RLS: anyone who can see the fixture reads the line-up; admins write it.
export function useLineup(fixture, open) {
  const [saved, setSaved] = useState(EMPTY)
  const [pool, setPool] = useState([])     // [{ id, name, status }] status: in | maybe | none | out, in that order
  const [wholeSquad, setWholeSquad] = useState(false) // true once the pool is the whole squad (from kickoff)
  const [names, setNames] = useState({})   // id -> 'First Last' (covers pool + picked)
  const [photos, setPhotos] = useState({}) // id -> headshot url (covers pool + picked)
  const [hasLineup, setHasLineup] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Latest wins: opening fixture A's sheet (slow) then B's (fast) must not paint
  // A's XI under B — and a save would then have written it to B. Each load takes
  // a ticket AND remembers which fixture it was for; a stale one sets nothing.
  const reqRef = useRef(0)
  const fixtureRef = useRef(fixture?.id)
  fixtureRef.current = fixture?.id

  const load = useCallback(async () => {
    const id = ++reqRef.current
    const fixtureId = fixture?.id
    const fresh = () => id === reqRef.current && fixtureId === fixtureRef.current
    // No fixture: resolve to an empty, non-loading state rather than a permanent
    // "Loading the line-up…".
    if (!fixtureId) { setSaved(EMPTY); setHasLineup(false); setPool([]); setWholeSquad(false); setNames({}); setPhotos({}); setLoading(false); setError(null); return }
    setLoading(true)
    setError(null)
    // Fail closed: a fixture with no resolvable team has no roster, so nobody is
    // pickable — better an empty pool for a moment than the wrong squad in it.
    const rosterQuery = fixture.team_id
      ? supabase.from('team_memberships')
          .select('profiles!inner(id, first_name, last_name, photo_url, active, approved, is_player)')
          .eq('team_id', fixture.team_id)
      : Promise.resolve({ data: [], error: null })

    try {
      const [lineRes, availRes, rosterRes] = await Promise.all([
        supabase.from('lineups')
          .select('profile_id, player_name, role, slot, position, formation, profiles(first_name, last_name, photo_url)')
          .eq('fixture_id', fixtureId),
        supabase.from('availability')
          .select('status, profiles!inner(id, first_name, last_name, photo_url)')
          .eq('fixture_id', fixtureId),
        rosterQuery,
      ])
      if (!fresh()) return

      // Failed load ≠ "no line-up saved": throw so the catch keeps data + error.
      // The roster is in here too — a pool that silently loses the squad it's
      // meant to be gated on is the same lie.
      const fetchErr = [lineRes, availRes, rosterRes].find((r) => r?.error)?.error
      if (fetchErr) throw fetchErr

      const nm = {}, ph = {}
      for (const r of lineRes.data ?? []) {
        // A since-deleted player has a null profile link but keeps player_name.
        const key = r.profile_id ?? `name:${r.player_name}`
        nm[key] = r.profiles ? `${r.profiles.first_name} ${r.profiles.last_name}` : (r.player_name ?? '—')
        ph[key] = r.profiles?.photo_url ?? null
      }
      // Who's pickable: the squad that plays THIS fixture. An availability row on
      // its own is not enough — a supporter, a pending signup or an ex-player can
      // still hold one, and pre-0034 rows exist against the wrong team entirely.
      // A pick becomes an appearance (useClub reads lineups), so the pool is the
      // only guard: lineups_admin_write does no team check.
      const roster = squadIds(rosterRes.data)

      const answer = {}
      for (const a of availRes.data ?? []) if (a.profiles && roster.has(a.profiles.id)) answer[a.profiles.id] = a.status

      // From kickoff: everyone in the squad, whatever they answered. Before it:
      // only those who said in or maybe.
      // (A postponed game past its old slot never kicked off.)
      const off = !!fixture.postponed || fixture.status === 'postponed'
      const started = !off && !!fixture.match_date && hasKickedOff(fixture.match_date, fixture.kickoff)
      const rank = { in: 0, maybe: 1, none: 2, out: 3 }
      const p = (rosterRes.data ?? [])
        .map((m) => m.profiles)
        .filter((pr) => pr && roster.has(pr.id))
        .map((pr) => ({ id: pr.id, name: `${pr.first_name} ${pr.last_name}`, photo_url: pr.photo_url ?? null, status: answer[pr.id] ?? 'none' }))
        .filter((pl) => started || pl.status === 'in' || pl.status === 'maybe')
        .sort((a, b) => (rank[a.status] - rank[b.status]) || a.name.localeCompare(b.name))
      for (const pl of p) { nm[pl.id] = pl.name; ph[pl.id] = pl.photo_url }

      setSaved(rowsToState(lineRes.data ?? []))
      setHasLineup((lineRes.data ?? []).length > 0)
      setPool(p)
      setWholeSquad(started)
      setNames(nm)
      setPhotos(ph)
    } catch (e) {
      if (!fresh()) return
      logError('fetch', e ?? 'useLineup load failed', { hook: 'useLineup', fixtureId })
      setError(e ?? new Error('load failed'))
    } finally {
      if (fresh()) setLoading(false)
    }
  }, [fixture?.id, fixture?.team_id, fixture?.match_date, fixture?.kickoff, fixture?.status, fixture?.postponed])

  useEffect(() => { if (open) load() }, [open, load])

  // Replace the whole line-up (small set; simpler + race-free than diffing).
  // delete-then-insert isn't atomic, so we snapshot what's there first: if the
  // insert fails we put the old XI back rather than leave the fixture with
  // nothing — and we ALWAYS reload afterwards so the board shows what the
  // database actually holds, never a line-up that only exists on this phone.
  const save = useCallback(async (rows) => {
    const fixtureId = fixture?.id
    if (!fixtureId) return { error: new Error('No fixture to save a line-up for.') }
    const snap = await supabase.from('lineups')
      .select('fixture_id, profile_id, player_name, role, slot, position, formation')
      .eq('fixture_id', fixtureId)
    if (snap.error) return { error: snap.error }
    const del = await supabase.from('lineups').delete().eq('fixture_id', fixtureId)
    if (del.error) return { error: del.error }
    let error = null
    if (rows.length) {
      const ins = await supabase.from('lineups').insert(rows)
      if (ins.error) {
        error = ins.error
        logError('write', ins.error, { hook: 'useLineup', op: 'save', fixtureId })
        if (snap.data?.length) {
          // Best effort: restore the previous line-up.
          const back = await supabase.from('lineups').insert(snap.data)
          if (back.error) logError('write', back.error, { hook: 'useLineup', op: 'save.restore', fixtureId })
        }
      }
    }
    await load()
    return { error }
  }, [fixture?.id, load])

  return { saved, pool, wholeSquad, names, photos, hasLineup, loading, error, save, refetch: load }
}
