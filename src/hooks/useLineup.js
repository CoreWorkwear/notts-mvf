import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { rowsToState } from '../lib/lineup'

// Line-up for one fixture: the saved selection (formation + starters + subs) and
// the pool of available players (who marked themselves in / maybe) to pick from.
// RLS: anyone who can see the fixture reads the line-up; admins write it.
export function useLineup(fixture, open) {
  const [saved, setSaved] = useState({ formation: '4-4-2', starters: {}, subs: [] })
  const [pool, setPool] = useState([])     // [{ id, name, status }] in/maybe, in first
  const [names, setNames] = useState({})   // id -> 'First Last' (covers pool + picked)
  const [hasLineup, setHasLineup] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!fixture?.id) return
    setLoading(true)
    const [lineRes, availRes] = await Promise.all([
      supabase.from('lineups')
        .select('profile_id, role, slot, position, formation, profiles(first_name, last_name)')
        .eq('fixture_id', fixture.id),
      supabase.from('availability')
        .select('status, profiles!inner(id, first_name, last_name)')
        .eq('fixture_id', fixture.id)
        .in('status', ['in', 'maybe']),
    ])

    const nm = {}
    for (const r of lineRes.data ?? []) {
      if (r.profiles) nm[r.profile_id] = `${r.profiles.first_name} ${r.profiles.last_name}`
    }
    const rank = { in: 0, maybe: 1 }
    const p = (availRes.data ?? [])
      .filter((a) => a.profiles)
      .map((a) => { nm[a.profiles.id] = `${a.profiles.first_name} ${a.profiles.last_name}`; return { id: a.profiles.id, name: nm[a.profiles.id], status: a.status } })
      .sort((a, b) => (rank[a.status] - rank[b.status]) || a.name.localeCompare(b.name))

    setSaved(rowsToState(lineRes.data ?? []))
    setHasLineup((lineRes.data ?? []).length > 0)
    setPool(p)
    setNames(nm)
    setLoading(false)
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

  return { saved, pool, names, hasLineup, loading, save, refetch: load }
}
