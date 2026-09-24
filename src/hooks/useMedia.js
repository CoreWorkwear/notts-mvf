import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { logError } from '../lib/logger'

// Club media: the photo pool (media_assets type 'photo') used behind poster
// heroes, plus crest updates. Club-scoped by RLS; writes are admin-only.
// The write helpers resolve { error } (never throw): the uploader has already
// put the file in Storage by the time they run, so a failed row write has to be
// reported to the manager, not lost as an unhandled rejection.
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
      if (fetchErr) throw fetchErr // failed load ≠ empty pool — catch keeps data + sets error
      setPhotos(data ?? [])
    } catch (e) {
      logError('fetch', e ?? 'useMedia load failed', { hook: 'useMedia' })
      setError(e ?? new Error('load failed'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const addPhoto = useCallback(async (url) => {
    const { error } = await supabase.from('media_assets')
      .insert({ club_id: profile.club_id, type: 'photo', url, uploaded_by: user?.id })
    if (error) { logError('write', error, { hook: 'useMedia', op: 'addPhoto' }); return { error } }
    await load()
    return { error: null }
  }, [profile?.club_id, user?.id, load])

  const removePhoto = useCallback(async (id) => {
    const { error } = await supabase.from('media_assets').delete().eq('id', id)
    if (error) { logError('write', error, { hook: 'useMedia', op: 'removePhoto', id }); return { error } }
    await load()
    return { error: null }
  }, [load])

  const setCrest = useCallback(async (url) => {
    const { error } = await supabase.from('clubs').update({ crest_url: url }).eq('id', profile.club_id)
    if (error) { logError('write', error, { hook: 'useMedia', op: 'setCrest' }); return { error } }
    await refreshProfile() // refresh AuthContext club so the new crest shows everywhere
    return { error: null }
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
