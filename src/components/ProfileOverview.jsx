import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/errors'
import { TEAMS } from '../lib/constants'
import ClubImage from './ClubImage'
import ImageUpload from './ImageUpload'
import PlayerAccount from './PlayerAccount'
import NotificationToggle from './NotificationToggle'
import FeelSettings from './FeelSettings'
import InstallPrompt from './InstallPrompt'
import './ProfileOverview.css'

export default function ProfileOverview() {
  const { profile, teamKeys, isRealAdmin, refreshProfile } = useAuth()
  const [editing, setEditing] = useState(false)
  const [firstName, setFirstName] = useState(profile.first_name)
  const [lastName, setLastName] = useState(profile.last_name)
  const [savedName, setSavedName] = useState(null)
  const [photo, setPhoto] = useState(profile.photo_url)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setPhoto(profile.photo_url) }, [profile.photo_url])
  useEffect(() => { setSavedName(null) }, [profile.first_name, profile.last_name])
  const name = savedName ?? { first: profile.first_name, last: profile.last_name }
  const initials = `${name.first?.[0] ?? ''}${name.last?.[0] ?? ''}`.toUpperCase()
  async function saveName(event) {
    event.preventDefault()
    if (!firstName.trim() || !lastName.trim()) { setError('Enter your first name and surname.'); return }
    setBusy(true); setError('')
    try {
      const { error } = await supabase.from('profiles').update({ first_name: firstName.trim(), last_name: lastName.trim() }).eq('id', profile.id)
      if (error) throw error
      setSavedName({ first: firstName.trim(), last: lastName.trim() }); setEditing(false); refreshProfile?.()
    } catch (failure) { setError(friendlyError(failure, "Couldn't save your name. Try again.")) }
    finally { setBusy(false) }
  }
  return <div className="page profile-overview">
    <div className="profile-identity">
      {photo ? <ClubImage className="profile-avatar" sizes="60px" loading="eager" src={photo} alt="" /> : <span className="profile-avatar mono" aria-label={`Initials ${initials}`}>{initials}</span>}
      <div className="grow"><h1 className="display">{name.first} {name.last}</h1><button type="button" className="btn btn-ghost mt-2" onClick={() => { setFirstName(name.first); setLastName(name.last); setEditing(true); setError('') }}>Edit name</button></div>
    </div>
    {(isRealAdmin || (profile.approved && profile.active)) ? <div className="mt-3"><ImageUpload compact folder={`players/${profile.id}`} shape="round" maxDim={512} current={photo} label={photo ? 'Change photo' : 'Add photo'} onUploaded={async url => {
      const { error } = await supabase.from('profiles').update({ photo_url: url }).eq('id', profile.id)
      if (error) throw error
      setPhoto(url); refreshProfile?.()
    }} /></div> : profile.active ? <p className="muted mt-3">Photo upload requires manager approval.</p> : null}
    {editing && <form className="col gap-3 mt-3" aria-label="Edit name" onSubmit={saveName}>
      <label className="field">First name<input className="input" autoComplete="given-name" value={firstName} disabled={busy} onChange={e => setFirstName(e.target.value)} /></label>
      <label className="field">Surname<input className="input" autoComplete="family-name" value={lastName} disabled={busy} onChange={e => setLastName(e.target.value)} /></label>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save name'}</button>
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setEditing(false); setError('') }}>Cancel</button>
    </form>}
    {error && <p className="field-error mt-2" role="alert">{error}</p>}
    <div className="row gap-2 mt-3 profile-badges">
      {teamKeys.map(key => <span key={key} className={`member-tag ${key}`}>{TEAMS[key]?.label ?? key}</span>)}
      {isRealAdmin && <span className="member-tag">Manager</span>}
    </div>
    {profile.is_player && <PlayerAccount profileId={profile.id} canPay />}
    <Link className="btn btn-ghost btn-block mt-3" to="/you/details">Edit details</Link>
    <section className="mt-5" aria-labelledby="profile-notifications"><h2 id="profile-notifications">Notifications</h2><div className="mt-3"><NotificationToggle /></div></section>
    <details className="profile-settings mt-5"><summary>App settings</summary><FeelSettings /><InstallPrompt /></details>
  </div>
}
