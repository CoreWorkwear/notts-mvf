import { useAuth } from '../context/AuthContext'
import { TEAMS } from '../lib/constants'

// You / Profile. Self-edit (name/phone/positions/preferred) lands at step 9;
// for now it shows the real record + badges from the auth context.
export default function Profile() {
  const { profile, teamKeys, isAdmin, xlEligible } = useAuth()
  if (!profile) return null

  return (
    <div className="page">
      <p className="kicker"><span className="kicker-rule">YOU</span></p>
      <h1 className="display mt-2" style={{ fontSize: 30 }}>
        {profile.first_name} {profile.last_name}
      </h1>

      <div className="row gap-2 mt-3" style={{ flexWrap: 'wrap' }}>
        {teamKeys.map((k) => (
          <span key={k} className={'chip' + (k === 'community' ? ' community' : '')} aria-pressed="true">
            {TEAMS[k]?.label ?? k}
          </span>
        ))}
        {xlEligible && <span className="chip" aria-pressed="true">XL eligible</span>}
        {isAdmin && <span className="chip" aria-pressed="true">Gaffer</span>}
      </div>

      <div className="card mt-5" style={{ padding: 16 }}>
        <Row label="Email" value={profile.email} />
        <Row label="Phone" value={profile.phone} />
        <Row label="Positions" value={profile.positions?.join(', ') || '—'} />
        <Row label="Preferred" value={profile.preferred || '—'} last />
      </div>
      <p className="dim mt-3" style={{ fontSize: 12 }}>
        Editing your details lands soon. Email is your login — the gaffer changes that.
      </p>
    </div>
  )
}

function Row({ label, value, last }) {
  return (
    <div className="row spread" style={{ padding: '10px 0', borderBottom: last ? 'none' : '1px solid var(--line)' }}>
      <span className="muted" style={{ fontSize: 14 }}>{label}</span>
      <span style={{ fontSize: 14 }}>{value}</span>
    </div>
  )
}
