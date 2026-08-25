import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { logError } from '../lib/logger'

// Club media: the photo pool (media_assets type 'photo') used behind poster
// heroes, plus crest updates. Club-scoped by RLS; writes are admin-only.
export function useMedia() {
  const { profile, user, refreshProfile } = useAuth()
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: fetchErr } = await supabase
        .from('media_assets')
        .select('id, url, created_at')
        .eq('type', 'photo')
        .order('created_at', { ascending: false })
      if (fetchErr) logError('fetch', fetchErr.message, { hook: 'useMedia' })
      setPhotos(data ?? [])
    } catch (e) {
      logError('fetch', e?.message ?? 'useMedia load failed', { hook: 'useMedia' })
      setError(e ?? new Error('load failed'))
    } finally {
      setLoading(false)
    }
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

  return { photos, loading, error, addPhoto, removePhoto, setCrest, refetch: load }
}

// Just the photo URLs — for the hero background pool. Decorative, so a failed
// fetch quietly leaves the pool empty rather than rejecting unhandled.
export function usePhotoPool() {
  const [pool, setPool] = useState([])
  useEffect(() => {
    let active = true
    supabase.from('media_assets').select('url').eq('type', 'photo')
      .then(({ data }) => { if (active) setPool((data ?? []).map((p) => p.url)) })
      .catch(() => {})
    return () => { active = false }
  }, [])
  return pool
}
