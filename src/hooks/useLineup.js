import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { rowsToState } from '../lib/lineup'
import { logError } from '../lib/logger'

// Line-up for one fixture: the saved selection (formation + starters + subs) and
// the pool of available players (who marked themselves in / maybe) to pick from.
// RLS: anyone who can see the fixture reads the line-up; admins write it.
export function useLineup(fixture, open) {
  const [saved, setSaved] = useState({ formation: '4-4-2', starters: {}, subs: [] })
  const [pool, setPool] = useState([])     // [{ id, name, status }] in/maybe, in first
  const [names, setNames] = useState({})   // id -> 'First Last' (covers pool + picked)
  const [photos, setPhotos] = useState({}) // id -> headshot url (covers pool + picked)
  const [hasLineup, setHasLineup] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!fixture?.id) return
    setLoading(true)
    setError(null)
    try {
      const [lineRes, availRes] = await Promise.all([
        supabase.from('lineups')
          .select('profile_id, player_name, role, slot, position, formation, profiles(first_name, last_name, photo_url)')
          .eq('fixture_id', fixture.id),
        supabase.from('availability')
          .select('status, profiles!inner(id, first_name, last_name, photo_url)')
          .eq('fixture_id', fixture.id)
          .in('status', ['in', 'maybe']),
      ])

      const fetchErr = [lineRes, availRes].find((r) => r?.error)?.error
      if (fetchErr) logError('fetch', fetchErr.message, { hook: 'useLineup', fixtureId: fixture.id })

      const nm = {}, ph = {}
      for (const r of lineRes.data ?? []) {
        // A since-deleted player has a null profile link but keeps player_name.
        const key = r.profile_id ?? `name:${r.player_name}`
        nm[key] = r.profiles ? `${r.profiles.first_name} ${r.profiles.last_name}` : (r.player_name ?? '—')
        ph[key] = r.profiles?.photo_url ?? null
      }
      const rank = { in: 0, maybe: 1 }
      const p = (availRes.data ?? [])
        .filter((a) => a.profiles)
        .map((a) => {
          nm[a.profiles.id] = `${a.profiles.first_name} ${a.profiles.last_name}`
          ph[a.profiles.id] = a.profiles.photo_url ?? null
          return { id: a.profiles.id, name: nm[a.profiles.id], photo_url: a.profiles.photo_url ?? null, status: a.status }
        })
        .sort((a, b) => (rank[a.status] - rank[b.status]) || a.name.localeCompare(b.name))

      setSaved(rowsToState(lineRes.data ?? []))
      setHasLineup((lineRes.data ?? []).length > 0)
      setPool(p)
      setNames(nm)
      setPhotos(ph)
    } catch (e) {
      logError('fetch', e?.message ?? 'useLineup load failed', { hook: 'useLineup', fixtureId: fixture?.id })
      setError(e ?? new Error('load failed'))
    } finally {
      setLoading(false)
    }
  }, [fixture?.id])

  useEffect(() => { if (open) load() }, [open, load])

  // Replace the whole line-up (small set; simpler + race-free than diffing).
  const save = useCallback(async (rows) => {
    const del = await supabase.from('lineups').delete().eq('fixture_id', fixture.id)
    if (del.error) return { error: del.error }
    if (rows.length) {
      const ins = await supabase.from('lineups').insert(rows)
      if (ins.error) return { error: ins.error }
    }
    await load()
    return { error: null }
  }, [fixture?.id, load])

  return { saved, pool, names, photos, hasLineup, loading, error, save, refetch: load }
}
