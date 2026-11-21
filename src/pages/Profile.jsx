import InstallPrompt from '../components/InstallPrompt'
import ClubImage from '../components/ClubImage'
import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { logError } from '../lib/logger'
import { friendlyError } from '../lib/errors'
import { TEAMS } from '../lib/constants'
import NotificationToggle from '../components/NotificationToggle'
import FeelSettings from '../components/FeelSettings'
import ImageUpload from '../components/ImageUpload'
import ProfileEdit from '../components/ProfileEdit'
import Toast from '../components/Toast'

// You / Profile. Shows the real record + badges, lets the player set their own
// avatar and edit their own details — everything except email (the account hangs
// off it). RLS lets you write your own row; the protect trigger blocks the
// privileged columns regardless.
export default function Profile() {
  const { profile, teamKeys, isRealAdmin, refreshProfile } = useAuth()
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  // The personal fields live in profile_private (self-or-admin RLS) — fetch
  // your own row; re-fetch when the edit sheet closes so a save shows at once.
  // The edit sheet must NOT open until this row has loaded: ProfileEdit
  // initialises its fields from it, so opening on a failed fetch would show
  // blank phone/DOB/emergency contact and a save would WIPE them.
  const [priv, setPriv] = useState(null)
  const [privReady, setPrivReady] = useState(false)
  const [attempt, setAttempt] = useState(0) // bumped to retry a failed fetch
  useEffect(() => {
    if (!profile?.id || editing) return
    let on = true
    supabase.from('profile_private')
      .select('email, phone, dob, ec_name, ec_phone')
      .eq('profile_id', profile.id).maybeSingle()
      .then(({ data, error: fetchErr }) => {
        if (!on) return
        if (fetchErr) throw fetchErr
        setPriv(data ?? {}); setPrivReady(true)
      })
      .catch((e) => { if (on) { setPrivReady(false); logError('fetch', e ?? 'profile_private load failed', { op: 'profilePrivate' }) } })
    return () => { on = false }
  }, [profile?.id, editing, attempt])
  if (!profile) return null
  const full = { ...profile, ...(priv ?? {}) }
  const openEdit = () => {
    if (privReady) { setEditing(true); return }
    setError("Couldn't load your details. Try again.")
    setAttempt((a) => a + 1) // kick off another fetch for the next tap
  }

  const initials = `${(profile.first_name?.[0] ?? '')}${(profile.last_name?.[0] ?? '')}`.toUpperCase()

  return (
    <div className="page">
      <Toast message={error} tone="error" onDismiss={() => setError(null)} />
      <p className="kicker"><span className="kicker-rule">YOU</span></p>

      <div className="row gap-3 mt-2" style={{ alignItems: 'center' }}>
        {profile.photo_url
          ? <ClubImage sizes="60px" loading="eager" className="you-av" src={profile.photo_url} alt="" />
          : <span className="you-av mono">{initials}</span>}
        <h1 className="display" style={{ fontSize: 'var(--type-display)' }}>
          {profile.first_name} {profile.last_name}
        </h1>
      </div>

      {/* Storage only takes a headshot from an approved, active member. Offering
          the button to anyone else got them a raw RLS refusal. */}
      {(isRealAdmin || (profile.approved && profile.active)) ? (
        <div className="mt-3" style={{ maxWidth: 280 }}>
          <ImageUpload
            folder={`players/${profile.id}`} shape="round" maxDim={512}
            current={profile.photo_url}
            label={profile.photo_url ? 'Change your photo' : 'Add your photo'}
            onUploaded={async (url) => {
              const { error } = await supabase.from('profiles').update({ photo_url: url }).eq('id', profile.id)
              if (error) { setError(friendlyError(error, "Couldn't save your photo. Try again.")); logError('write', error, { op: 'avatar' }) }
              else refreshProfile?.()
            }}
          />
        </div>
      ) : profile.active ? (
        <p className="dim mt-3" style={{ fontSize: 'var(--type-sm)' }}>Photo upload requires manager approval.</p>
      ) : null}
      <style>{`.you-av { width: 60px; height: 60px; border-radius: 50%; flex: none; object-fit: cover;
        display: grid; place-items: center; background: var(--slate); border: 1px solid var(--line-2);
        font-size: var(--type-lg); font-weight: 700; color: var(--bone-mute); }`}</style>

      <div className="row gap-2 mt-3" style={{ flexWrap: 'wrap' }}>
        {teamKeys.map((k) => (
          <span key={k} className={'member-tag ' + k}>
            {TEAMS[k]?.label ?? k}
          </span>
        ))}
        {isRealAdmin && <span className="member-tag">Manager</span>}
      </div>

      <dl className="card mt-5" style={{ padding: 'var(--space-4)' }}>
        <Row label="Email" value={full.email ?? '—'} />
        <Row label="Phone" value={full.phone ?? '—'} numeric />
        <Row label="Date of birth" value={formatDob(full.dob)} numeric />
        <Row label="Positions" value={full.positions?.join(', ') || '—'} numeric />
        <Row label="Preferred" value={full.preferred || '—'} numeric />
        <Row label="Emergency contact" value={full.ec_name || '—'} />
        <Row label="Emergency phone" value={full.ec_phone || '—'} numeric />
      </dl>
      <button className="btn btn-ghost btn-block mt-3" onClick={openEdit}>Edit your details</button>

      <ProfileEdit open={editing} onClose={() => setEditing(false)} profile={full} onSaved={refreshProfile} />

      <p className="kicker mt-5"><span className="kicker-rule">NOTIFICATIONS</span></p>
      <div className="mt-3"><NotificationToggle /></div>

      <InstallPrompt />
      <FeelSettings />
    </div>
  )
}

function formatDob(dob) {
  if (!dob) return '—'
  const [y, m, d] = dob.split('-')
  return `${d}/${m}/${y}`
}

function Row({ label, value, numeric }) {
  return <div className="profile-field">
    <dt className="muted">{label}</dt>
    <dd className={numeric ? 'mono' : undefined}>{value}</dd>
  </div>
}
