import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Club media: the photo pool (media_assets type 'photo') used behind poster
// heroes, plus crest updates. Club-scoped by RLS; writes are admin-only.
export function useMedia() {
  const { profile, user, refreshProfile } = useAuth()
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('media_assets')
      .select('id, url, created_at')
      .eq('type', 'photo')
      .order('created_at', { ascending: false })
    setPhotos(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const addPhoto = useCallback(async (url) => {
    const { error } = await supabase.from('media_assets')
      .insert({ club_id: profile.club_id, type: 'photo', url, uploaded_by: user?.id })
    if (error) throw error
    await load()
  }, [profile?.club_id, user?.id, load])

  const removePhoto = useCallback(async (id) => {
    const { error } = await supabase.from('media_assets').delete().eq('id', id)
    if (error) throw error
    await load()
  }, [load])

  const setCrest = useCallback(async (url) => {
    const { error } = await supabase.from('clubs').update({ crest_url: url }).eq('id', profile.club_id)
    if (error) throw error
    await refreshProfile() // refresh AuthContext club so the new crest shows everywhere
  }, [profile?.club_id, refreshProfile])

  return { photos, loading, addPhoto, removePhoto, setCrest, refetch: load }
}

// Just the photo URLs — for the hero background pool.
export function usePhotoPool() {
  const [pool, setPool] = useState([])
  useEffect(() => {
    let active = true
    supabase.from('media_assets').select('url').eq('type', 'photo')
      .then(({ data }) => { if (active) setPool((data ?? []).map((p) => p.url)) })
    return () => { active = false }
  }, [])
  return pool
}
