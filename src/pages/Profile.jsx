import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { logError } from '../lib/logger'
import { TEAMS } from '../lib/constants'
import NotificationToggle from '../components/NotificationToggle'
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
  if (!profile) return null

  const initials = `${(profile.first_name?.[0] ?? '')}${(profile.last_name?.[0] ?? '')}`.toUpperCase()

  return (
    <div className="page">
      <Toast message={error} tone="error" onDismiss={() => setError(null)} />
      <p className="kicker"><span className="kicker-rule">YOU</span></p>

      <div className="row gap-3 mt-2" style={{ alignItems: 'center' }}>
        {profile.photo_url
          ? <img className="you-av" src={profile.photo_url} alt="" />
          : <span className="you-av mono">{initials}</span>}
        <h1 className="display" style={{ fontSize: 30 }}>
          {profile.first_name} {profile.last_name}
        </h1>
      </div>

      <div className="mt-3" style={{ maxWidth: 280 }}>
        <ImageUpload
          folder="players" shape="round" maxDim={512}
          current={profile.photo_url}
          label={profile.photo_url ? 'Change your photo' : 'Add your photo'}
          hint="A square head-and-shoulders shot works best (e.g. 512×512) — it's cropped to a circle."
          onUploaded={async (url) => {
            const { error } = await supabase.from('profiles').update({ photo_url: url }).eq('id', profile.id)
            if (error) { setError(error.message); logError('write', error.message, { op: 'avatar' }) }
            else refreshProfile?.()
          }}
        />
      </div>
      <style>{`.you-av { width: 60px; height: 60px; border-radius: 50%; flex: none; object-fit: cover;
        display: grid; place-items: center; background: var(--slate); border: 1px solid var(--line-2);
        font-size: 20px; font-weight: 700; color: var(--bone-mute); }`}</style>

      <div className="row gap-2 mt-3" style={{ flexWrap: 'wrap' }}>
        {teamKeys.map((k) => (
          <span key={k} className={'chip' + (k === 'community' ? ' community' : '')} aria-pressed="true">
            {TEAMS[k]?.label ?? k}
          </span>
        ))}
        {isRealAdmin && <span className="chip" aria-pressed="true">Manager</span>}
      </div>

      <div className="card mt-5" style={{ padding: 16 }}>
        <Row label="Email" value={profile.email} />
        <Row label="Phone" value={profile.phone} />
        <Row label="Date of birth" value={formatDob(profile.dob)} />
        <Row label="Positions" value={profile.positions?.join(', ') || '—'} />
        <Row label="Preferred" value={profile.preferred || '—'} />
        <Row label="Emergency contact" value={profile.ec_name || '—'} />
        <Row label="Emergency phone" value={profile.ec_phone || '—'} last />
      </div>
      <button className="btn btn-ghost btn-block mt-3" onClick={() => setEditing(true)}>Edit your details</button>
      <p className="dim mt-2" style={{ fontSize: 12 }}>Email is your login — the manager changes that.</p>

      <ProfileEdit open={editing} onClose={() => setEditing(false)} profile={profile} onSaved={refreshProfile} />

      <p className="kicker mt-5"><span className="kicker-rule">NOTIFICATIONS</span></p>
      <div className="mt-3"><NotificationToggle /></div>
    </div>
  )
}

function formatDob(dob) {
  if (!dob) return '—'
  const [y, m, d] = dob.split('-')
  return `${d}/${m}/${y}`
}

function Row({ label, value, last }) {
  return (
    <div className="row spread" style={{ padding: '10px 0', borderBottom: last ? 'none' : '1px solid var(--line)' }}>
      <span className="muted" style={{ fontSize: 14 }}>{label}</span>
      <span style={{ fontSize: 14 }}>{value}</span>
    </div>
  )
}
