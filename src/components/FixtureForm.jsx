import { useEffect, useRef, useState } from 'react'
import Sheet from './Sheet'
import Toast from './Toast'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { FIXTURE_TYPES } from '../lib/constants'
import { todayISO } from '../lib/format'

// Admin create/edit a fixture. Opponent is picked from the opponents table or
// added inline (so the badge attaches to the opponent, reused across fixtures).
// League name shows only for League type, auto-filled from the team, overridable.
// The form stays mounted (so the bottom-sheet's hardware-back stays sane); we
// reset the fields each time it opens so Edit prefills the right fixture.
export default function FixtureForm({ open, onClose, onSaved, teams, opponents, seasonId, fixture }) {
  const { profile } = useAuth()
  const editing = !!fixture
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [invalid, setInvalid] = useState(new Set())
  const clearInvalid = (k) => setInvalid((s) => { if (!s.has(k)) return s; const n = new Set(s); n.delete(k); return n })
  const formRef = useRef(null)

  // On a failed save, jump to (and focus) the first flagged field so it's
  // obvious what to fix. scrollIntoView is guarded — jsdom doesn't implement it.
  useEffect(() => {
    if (invalid.size === 0) return
    const el = formRef.current?.querySelector('[aria-invalid="true"]')
    if (el) { el.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); el.focus?.({ preventScroll: true }) }
  }, [invalid])

  const [teamId, setTeamId] = useState('')
  const [opponentId, setOpponentId] = useState('')
  const [newOpponent, setNewOpponent] = useState('')
  const [matchDate, setMatchDate] = useState(todayISO())
  const [kickoff, setKickoff] = useState('13:00')
  const [homeAway, setHomeAway] = useState('Home')
  const [type, setType] = useState('League')
  const [venue, setVenue] = useState('')
  const [address, setAddress] = useState('')
  const [w3w, setW3w] = useState('')
  const [status, setStatus] = useState('scheduled')
  const [leagueName, setLeagueName] = useState('')

  // Prefill (or clear) when the sheet opens.
  useEffect(() => {
    if (!open) return
    setError(null)
    setInvalid(new Set())
    setTeamId(fixture?.team_id ?? teams[0]?.id ?? '')
    setOpponentId(fixture?.opponent_id ?? '')
    setNewOpponent('')
    setMatchDate(fixture?.match_date ?? todayISO())
    setKickoff((fixture?.kickoff ?? '13:00').slice(0, 5))
    setHomeAway(fixture?.home_away ?? 'Home')
    setType(fixture?.fixture_type ?? 'League')
    setVenue(fixture?.venue ?? '')
    setAddress(fixture?.address ?? '')
    setW3w(fixture?.w3w ?? '')
    setStatus(fixture?.status ?? 'scheduled')
    setLeagueName(fixture?.league_name ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const team = teams.find((t) => t.id === teamId)
  // League name defaults from the team when League type and not yet set.
  const effectiveLeague = leagueName || (type === 'League' ? team?.league_name ?? '' : '')

  async function onDelete() {
    if (!confirm('Bin this fixture off? This removes it and any availability for it.')) return
    setBusy(true)
    const { error } = await supabase.from('fixtures').delete().eq('id', fixture.id)
    setBusy(false)
    if (error) { setError(error.message); return }
    onSaved(); onClose()
  }

  async function onSubmit(e) {
    e.preventDefault()
    setError(null)

    // Collect every missing required field so we can flag them all at once.
    const miss = []
    if (!teamId) miss.push('team')
    if (!opponentId && !newOpponent.trim()) miss.push('opponent')
    if (!matchDate) miss.push('date')
    if (!kickoff) miss.push('kickoff')
    if (!venue.trim()) miss.push('venue')
    if (miss.length) {
      setInvalid(new Set(miss))
      setError(`Still needs: ${miss.join(', ')}.`)
      return
    }
    // Guard the required FKs so a not-yet-loaded season/profile can't produce a
    // silent insert that the DB rejects ("save does nothing").
    if (!seasonId) { setError('No season selected yet — pick a season up top, then try again.'); return }
    if (!profile?.club_id) { setError('Your profile is still loading — give it a second and try again.'); return }

    setBusy(true)
    try {
      let oppId = opponentId
      if (!oppId && newOpponent.trim()) {
        const { data, error } = await supabase
          .from('opponents')
          .insert({ club_id: profile.club_id, name: newOpponent.trim() })
          .select('id').single()
        if (error) throw error
        oppId = data.id
      }

      const payload = {
        club_id: profile.club_id,
        season_id: seasonId,
        team_id: teamId,
        opponent_id: oppId,
        match_date: matchDate,
        kickoff,
        home_away: homeAway,
        fixture_type: type,
        league_name: type === 'League' ? (effectiveLeague || null) : null,
        venue: venue.trim(),
        address: address.trim() || null,
        w3w: w3w.trim() || null,
        status,
      }

      const res = editing
        ? await supabase.from('fixtures').update(payload).eq('id', fixture.id)
        : await supabase.from('fixtures').insert(payload)
      if (res.error) throw res.error

      onSaved(); onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <Toast message={error} onDismiss={() => setError(null)} />
      <p className="kicker"><span className="kicker-rule">{editing ? 'EDIT FIXTURE' : 'NEW FIXTURE'}</span></p>
      <h2 className="display mt-2" style={{ fontSize: 26 }}>{editing ? 'Edit the game' : 'Add a game'}</h2>

      <form className="col gap-3 mt-4" onSubmit={onSubmit} ref={formRef}>
        <div className="field">
          <label className="label">Team</label>
          <select className="select" value={teamId} aria-invalid={invalid.has('team') || undefined}
            onChange={(e) => { setTeamId(e.target.value); clearInvalid('team') }}>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>

        <div className="field">
          <label className="label">Opponent</label>
          <select className="select" value={opponentId} aria-invalid={invalid.has('opponent') || undefined}
            onChange={(e) => { setOpponentId(e.target.value); clearInvalid('opponent') }}>
            <option value="">— add a new one below —</option>
            {opponents.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          {!opponentId && (
            <input className="input mt-2" placeholder="New opponent name" value={newOpponent} aria-invalid={invalid.has('opponent') || undefined}
              onChange={(e) => { setNewOpponent(e.target.value); clearInvalid('opponent') }} />
          )}
        </div>

        <div className="row gap-2">
          <div className="field grow">
            <label className="label">Date</label>
            <input className="input" type="date" value={matchDate} aria-invalid={invalid.has('date') || undefined}
              onChange={(e) => { setMatchDate(e.target.value); clearInvalid('date') }} />
          </div>
          <div className="field grow">
            <label className="label">Kickoff</label>
            <input className="input" type="time" value={kickoff} aria-invalid={invalid.has('kickoff') || undefined}
              onChange={(e) => { setKickoff(e.target.value); clearInvalid('kickoff') }} />
          </div>
        </div>

        <div className="row gap-2">
          <div className="field grow">
            <label className="label">Home / Away</label>
            <select className="select" value={homeAway} onChange={(e) => setHomeAway(e.target.value)}>
              <option>Home</option><option>Away</option>
            </select>
          </div>
          <div className="field grow">
            <label className="label">Type</label>
            <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
              {FIXTURE_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {type === 'League' && (
          <div className="field">
            <label className="label">League</label>
            <input className="input" value={effectiveLeague} onChange={(e) => setLeagueName(e.target.value)} placeholder="League name" />
          </div>
        )}

        <div className="field">
          <label className="label">Venue</label>
          <input className="input" value={venue} aria-invalid={invalid.has('venue') || undefined}
            onChange={(e) => { setVenue(e.target.value); clearInvalid('venue') }} placeholder="e.g. Harvey Hadden 4G" />
        </div>
        <div className="field">
          <label className="label">Address</label>
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="field">
          <label className="label">what3words</label>
          <input className="input" value={w3w} onChange={(e) => setW3w(e.target.value)} placeholder="///filled.count.soap" />
        </div>

        <div className="field">
          <label className="label">Status</label>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="scheduled">On as scheduled</option>
            <option value="postponed">Postponed (P-P)</option>
          </select>
          {status === 'postponed' && (
            <span className="dim" style={{ fontSize: 12 }}>Stays in Fixtures with a P-P tag until kickoff passes, then archives to Results.</span>
          )}
        </div>

        <button className="btn btn-primary btn-block mt-2" disabled={busy}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Add fixture'}
        </button>
        {editing && (
          <button type="button" className="btn btn-ghost btn-block" disabled={busy} onClick={onDelete}
            style={{ color: 'var(--red-bright)', borderColor: 'var(--line)' }}>
            Bin this fixture
          </button>
        )}
      </form>
    </Sheet>
  )
}
