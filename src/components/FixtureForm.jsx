import { useEffect, useRef, useState } from 'react'
import Sheet from './Sheet'
import Toast from './Toast'
import ImageUpload from './ImageUpload'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { teamLabel } from '../lib/teams'
import { FIXTURE_TYPES } from '../lib/constants'
import { todayISO } from '../lib/format'
import { geocodePostcode, normalizePostcode } from '../lib/geocode'

// Admin create/edit a fixture. Opponent is picked from the opponents table or
// added inline (so the badge attaches to the opponent, reused across fixtures).
// League name shows only for League type, auto-filled from the team, overridable.
// The form stays mounted (so the bottom-sheet's hardware-back stays sane); we
// reset the fields each time it opens so Edit prefills the right fixture.
export default function FixtureForm({ open, onClose, onSaved, teams, opponents, competitions = [], seasonId, fixture }) {
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
  const [postcode, setPostcode] = useState('')
  const [w3w, setW3w] = useState('')
  const [status, setStatus] = useState('scheduled')
  const [competitionId, setCompetitionId] = useState('')
  // True while the venue / address / postcode on screen are the ones WE copied
  // in from an opponent's home ground, not ones the manager typed or that came
  // with the fixture. Only an autofill may be replaced or cleared by another.
  const autoVenue = useRef(false)

  // Prefill (or clear) when the sheet opens.
  useEffect(() => {
    if (!open) return
    // A saved away game whose venue IS its opponent's ground on file counts as
    // our fill, so correcting the opponent moves the ground with it. Anything
    // else that came with the fixture is the manager's and is left alone.
    const opp0 = opponents.find((o) => o.id === fixture?.opponent_id)
    autoVenue.current = !!fixture && fixture.home_away === 'Away' && !!opp0?.home_venue
      && (fixture.venue ?? '') === (opp0.home_venue ?? '')
      && (fixture.address ?? '') === (opp0.home_address ?? '')
      && (fixture.postcode ?? '') === (opp0.home_postcode ?? '')
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
    setPostcode(fixture?.postcode ?? '')
    setW3w(fixture?.w3w ?? '')
    setStatus(fixture?.status ?? 'scheduled')
    setCompetitionId(fixture?.competition_id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // An opponent's saved home ground is where an AWAY game is played, so that is
  // the only time it is copied in — and as one ground, all three fields
  // together (blanking the ones they have not got), never field by field: a
  // ground name over the previous opponent's address and postcode sent the
  // map, directions and weather to the wrong place. It never touches a venue
  // the manager typed or one the fixture already had; it only fills blanks and
  // replaces (or, for a home game, removes) its own earlier fill.
  function fillGround(oppId, homeOrAway) {
    const opp = opponents.find((o) => o.id === oppId)
    const hasGround = !!(opp?.home_venue || opp?.home_address || opp?.home_postcode)
    const blank = !venue.trim() && !address.trim() && !postcode.trim()
    if (homeOrAway === 'Away' && hasGround) {
      if (!blank && !autoVenue.current) return
      setVenue(opp.home_venue ?? ''); setAddress(opp.home_address ?? ''); setPostcode(opp.home_postcode ?? '')
      autoVenue.current = true
      if (opp.home_venue) clearInvalid('venue')
    } else if (autoVenue.current) {
      setVenue(''); setAddress(''); setPostcode('')
      autoVenue.current = false
    }
  }
  function pickOpponent(id) {
    setOpponentId(id); clearInvalid('opponent')
    fillGround(id, homeAway)
  }
  function pickHomeAway(v) {
    setHomeAway(v)
    fillGround(opponentId, v)
  }
  // Anything typed into the three fields makes them the manager's own.
  const typed = (set) => (e) => { autoVenue.current = false; set(e.target.value) }

  // League defaults from the team but is shown as a placeholder hint, not a
  // pre-filled value (which reads as stale). The default is applied on save.
  const competition = competitions.find((c) => c.id === competitionId) || null

  // The delete cascades (0001, 0012): availability and the line-up always go,
  // and a played game takes its result, scorers and subs with it. Say so — the
  // old wording mentioned only availability, and there is no undo.
  async function onDelete() {
    const ask = fixture.hasResult
      ? 'Permanently delete this fixture, result, scorers, availability, line-up and subs?'
      : 'Permanently delete this fixture, its availability and line-up?'
    if (!confirm(ask)) return
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
      setError(`Required: ${miss.join(', ')}.`)
      return
    }
    // Guard the required FKs so a not-yet-loaded season/profile can't produce a
    // silent insert that the DB rejects ("save does nothing").
    if (!seasonId) { setError('Select a season before saving.'); return }
    if (!profile?.club_id) { setError('Profile loading. Try again shortly.'); return }

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

      // Geocode the postcode → venue coords for venue-precise weather. Non-fatal:
      // a bad/unknown postcode just leaves coords null (weather falls back to
      // the club city). Skip the lookup if the postcode is unchanged on an edit.
      const pc = normalizePostcode(postcode)
      let coords = { lat: fixture?.venue_lat ?? null, lng: fixture?.venue_lng ?? null }
      if (pc !== normalizePostcode(fixture?.postcode ?? '')) {
        coords = pc ? (await geocodePostcode(pc)) ?? { lat: null, lng: null } : { lat: null, lng: null }
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
        competition_id: competitionId || null,
        league_name: competition?.name ?? null, // denormalised for display fallback
        venue: venue.trim(),
        address: address.trim() || null,
        postcode: pc || null,
        venue_lat: coords.lat,
        venue_lng: coords.lng,
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
      <h2 className="display mt-2" style={{ fontSize: 'var(--type-title)' }}>{editing ? 'Edit fixture' : 'Add fixture'}</h2>

      <form className="fixture-form col gap-3 mt-4" onSubmit={onSubmit} ref={formRef}>
        <div className="field">
          <span className="label">Team</span>
          <div className="fixture-pills" role="group" aria-label="Team">
            {teams.map(t => <button key={t.id} type="button" className={'chip' + (t.key === 'community' ? ' community' : '')}
              aria-pressed={teamId === t.id} aria-invalid={invalid.has('team') || undefined}
              onClick={() => { setTeamId(t.id); clearInvalid('team') }}>{teamLabel(t)}</button>)}
          </div>
        </div>

        <div className="field">
          <label className="label">Opponent</label>
          <select className="select" value={opponentId} aria-invalid={invalid.has('opponent') || undefined}
            onChange={(e) => pickOpponent(e.target.value)}>
            <option value="">— add a new one below —</option>
            {opponents.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          {!opponentId && (
            <input className="input mt-2" placeholder="New opponent name" value={newOpponent} aria-invalid={invalid.has('opponent') || undefined}
              onChange={(e) => { setNewOpponent(e.target.value); clearInvalid('opponent') }} />
          )}
          {opponentId && (
            <div className="mt-2">
              <span className="label">Opponent badge</span>
              <div className="mt-1">
                <ImageUpload
                  key={opponentId} // fresh picker per opponent, so the badge preview can't lag behind the pick
                  folder="opponents" shape="round" maxDim={256}
                  current={opponents.find((o) => o.id === opponentId)?.badge_url}
                  label={opponents.find((o) => o.id === opponentId)?.badge_url ? 'Replace badge' : 'Add badge'}
                  onUploaded={async (url) => {
                    const { error } = await supabase.from('opponents').update({ badge_url: url }).eq('id', opponentId)
                    if (error) setError(error.message)
                  }}
                />
              </div>
            </div>
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
            <select className="select" aria-label="Home or away" value={homeAway} onChange={(e) => pickHomeAway(e.target.value)}>
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

        <div className="field">
          <label className="label">Competition</label>
          <select className="select" aria-label="Competition" value={competitionId} onChange={(e) => setCompetitionId(e.target.value)}>
            <option value="">— none (friendly) —</option>
            {/* Active leagues only, but keep a retired one selectable if this fixture already uses it. */}
            {competitions.filter((c) => c.active !== false || c.id === competitionId)
              .map((c) => <option key={c.id} value={c.id}>{c.name}{c.active === false ? ' (retired)' : ''}</option>)}
          </select>
          {competitions.length === 0 && <span className="dim" style={{ fontSize: 'var(--type-caption)' }}>Add competitions in Manage → Competitions</span>}
        </div>

        <div className="field">
          <label className="label">Venue</label>
          <input className="input" value={venue} aria-invalid={invalid.has('venue') || undefined}
            onChange={(e) => { autoVenue.current = false; setVenue(e.target.value); clearInvalid('venue') }} placeholder="e.g. Harvey Hadden 4G" />
        </div>
        <div className="row gap-2">
          <div className="field grow">
            <label className="label">Address</label>
            <input className="input" aria-label="Address" value={address} onChange={typed(setAddress)} />
          </div>
          <div className="field">
            <label className="label">Postcode</label>
            <input className="input" aria-label="Postcode" value={postcode} onChange={typed(setPostcode)}
              placeholder="NG18 4YD" style={{ textTransform: 'uppercase', maxWidth: 130 }} />
          </div>
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
        </div>

        {editing && (
          <button type="button" className="btn btn-ghost btn-block" disabled={busy} onClick={onDelete}
            style={{ color: 'var(--red-bright)', borderColor: 'var(--line)' }}>
            Delete fixture
          </button>
        )}
        <div className="sheet-actions">
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add fixture'}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
