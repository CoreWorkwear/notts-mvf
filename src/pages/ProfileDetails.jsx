import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePaymentsRelease } from '../hooks/usePaymentsRelease'
import { supabase } from '../lib/supabase'
import ProfileEdit from '../components/ProfileEdit'

export default function ProfileDetails() {
  const { profile, refreshProfile } = useAuth()
  const release = usePaymentsRelease(profile?.id, profile?.club_id)
  const navigate = useNavigate()
  const [privateRow, setPrivateRow] = useState(null)
  const [loadedFor, setLoadedFor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!profile?.id || !release.enabled) return
    let on = true
    setLoading(true); setFailed(false); setPrivateRow(null)
    supabase.from('profile_private').select('email, phone, dob, ec_name, ec_phone').eq('profile_id', profile.id).maybeSingle().then(({ data, error }) => {
      // A missing row is not a blank form: saving it could erase private data.
      if (error || !data?.email) throw error ?? new Error('Private details unavailable')
      if (on) { setPrivateRow(data); setLoadedFor(profile.id) }
    }).catch(() => { if (on) setFailed(true) }).finally(() => { if (on) setLoading(false) })
    return () => { on = false }
  }, [profile?.id, release.enabled, attempt])
  const back = () => navigate('/you')
  return <div className="page">
    <Link to="/you" className="btn btn-ghost">Back</Link>
    <h1 className="display mt-3" style={{ fontSize: 'var(--type-display)' }}>Edit details</h1>
    {release.error ? <div role="alert" className="mt-3"><p>Couldn't check your account.</p><button className="btn btn-ghost mt-2" onClick={release.retry}>Try again</button></div> : release.loading && !release.enabled ? <p role="status" className="mt-3">Loading your account…</p> : !release.enabled ? <p className="mt-3">Open You to edit your details.</p> : failed ? <div role="alert" className="mt-3"><p>Couldn't load your details. Existing details have been kept.</p><button className="btn btn-ghost mt-2" onClick={() => setAttempt(a => a + 1)}>Try again</button></div> : loading || loadedFor !== profile?.id ? <p role="status" className="mt-3">Loading your details…</p> : <ProfileEdit mode="details" open profile={{ ...profile, ...privateRow }} onSaved={refreshProfile} onClose={back} />}
  </div>
}
