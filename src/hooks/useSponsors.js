import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Club sponsors (logo banners). Anyone in the club reads; admins write.
export function useSponsors() {
  const { profile } = useAuth()
  const [sponsors, setSponsors] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('sponsors')
      .select('id, name, logo_url, website, tier, sort_order, active')
      .order('tier', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    setSponsors(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const save = useCallback(async ({ id, name, tier, website, logo_url, active }) => {
    const row = {
      name: name.trim(),
      tier,
      website: website?.trim() || null,
      logo_url: logo_url || null,
      active: active !== false,
    }
    const res = id
      ? await supabase.from('sponsors').update(row).eq('id', id)
      : await supabase.from('sponsors').insert({ club_id: profile.club_id, ...row })
    if (res.error) throw res.error
    await load()
  }, [profile?.club_id, load])

  const remove = useCallback(async (id) => {
    const { error } = await supabase.from('sponsors').delete().eq('id', id)
    if (error) throw error
    await load()
  }, [load])

  return { sponsors, loading, save, remove, refetch: load }
}

// Active sponsors of a tier, e.g. byTier(sponsors, 'main').
export function byTier(sponsors, tier) {
  return (sponsors ?? []).filter((s) => s.active && s.tier === tier && s.logo_url)
}
