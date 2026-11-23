import ClubImage from './ClubImage'
import { useEffect, useState } from 'react'
import Sheet from './Sheet'
import LoadIssue from './LoadIssue'
import { logError } from '../lib/logger'
import ScoreBug from './ScoreBug'
import PitchView from './PitchView'
import { supabase } from '../lib/supabase'
import { resolveName } from '../hooks/useResults'
import { rowsToState } from '../lib/lineup'
import { isSquadMember } from '../lib/players'
import { fmtDateLong } from '../lib/format'
import { heroBackground } from '../lib/media'
import { fixtureMatchup, halfTimeScore } from '../lib/teams'
import { IconCompetitions } from './Icons'
import '../styles/editorial.css'

// Match centre (HANDOVER §5): big FT score + HT, MOTM with a star, the goal
// timeline, and who actually played — the manager's selected line-up (pitch +
// subs) for games where one was named, falling back to availability='in' for
// older games with no line-up.
export default function MatchCentre({ open, onClose, fixture, isAdmin, pool = [], onEdit }) {
  const [played, setPlayed] = useState([])   // fallback: [{id, name}] marked in
  const [lineup, setLineup] = useState(null) // { formation, starters, subs } or null
  const [lineNames, setLineNames] = useState({}) // profile_id -> 'First Last'
  const [linePhotos, setLinePhotos] = useState({}) // profile_id -> headshot url
  const [motmSponsor, setMotmSponsor] = useState(null)
  const [zoom, setZoom] = useState(false) // MOTM photo lightbox
  const [squadState, setSquadState] = useState('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!open) return
    supabase.from('sponsors').select('name, logo_url, website').eq('tier', 'motm').eq('active', true)
      .then(({ data }) => setMotmSponsor((data ?? [])[0] ?? null))
      .catch(() => {}) // decorative — a dropped fetch just hides the sponsor
  }, [open])

  useEffect(() => {
    if (!open || !fixture) return
    let active = true
    setSquadState('loading'); setLineup(null); setLineNames({}); setLinePhotos({}); setPlayed([]); setZoom(false)
    ;(async () => {
      const { data: lrows, error: lineupError } = await supabase
        .from('lineups')
        .select('profile_id, player_name, role, slot, position, formation, profiles(first_name, last_name, photo_url)')
        .eq('fixture_id', fixture.id)
      if (!active) return
      if (lineupError) throw lineupError
      if (lrows && lrows.length) {
        // Key by profile_id, falling back to the name snapshot for a since-deleted
        // player so they still appear in this past line-up.
        const keyOf = (r) => r.profile_id ?? `name:${r.player_name}`
        const nm = {}, ph = {}
        for (const r of lrows) {
          nm[keyOf(r)] = r.profiles ? `${r.profiles.first_name} ${r.profiles.last_name}` : (r.player_name ?? '—')
          ph[keyOf(r)] = r.profiles?.photo_url ?? null
        }
        setLineNames(nm)
        setLinePhotos(ph)
        setLineup(rowsToState(lrows, keyOf))
        setSquadState('ready')
        return
      }
      const { data, error: availabilityError } = await supabase
        .from('availability')
        .select('status, profile:profiles(id, first_name, last_name, active, approved, is_player)')
        .eq('fixture_id', fixture.id)
        .eq('status', 'in')
      if (!active) return
      if (availabilityError) throw availabilityError
      // An 'in' row is not proof of a squad place: supporters, players still
      // waiting on the manager's sign-off and removed players can all hold one.
      // Only squad members count towards the fallback list — anyone else who
      // actually contributed still shows via the goals/assists tally below.
      setPlayed((data ?? []).filter((a) => isSquadMember(a.profile)).map((a) => ({
        id: a.profile.id, name: `${a.profile.first_name ?? ''} ${a.profile.last_name ?? ''}`.trim(),
      })))
      setSquadState('ready')
    })().catch(error => {
      if (!active) return
      logError('fetch', error, { op: 'matchCentreLineup', fixtureId: fixture.id })
      setSquadState('error')
    })
    return () => { active = false }
  }, [open, fixture, attempt])

  if (!fixture) return null
  const f = fixture
  const r = f.result
  const sb = f.squadById ?? {}
  const isXL = f.team?.key === 'xl'
  const grad = isXL ? 'var(--grad-xl)' : 'var(--grad-community)'
  const motm = resolveName(sb, r.motm_profile_id, r.motm_name)

  // Tally goals/assists per resolved name (key by profile_id then free name).
  const tally = {}
  const bump = (key, field) => { if (!key) return; tally[key] = tally[key] || { g: 0, a: 0 }; tally[key][field]++ }
  for (const g of f.goals) {
    bump(resolveName(sb, g.scorer_profile_id, g.scorer_name), 'g')
    bump(resolveName(sb, g.assist_profile_id, g.assist_name), 'a')
  }
  // Squad list = those marked in, merged with anyone in the tally (guests).
  const names = new Set(played.map((p) => p.name).filter(Boolean))
  Object.keys(tally).forEach((n) => names.add(n))

  // Per-player goals/assists by id, for badges on the line-up pitch + subs.
  const goalsById = {}, assistsById = {}
  for (const g of f.goals) {
    if (g.scorer_profile_id) goalsById[g.scorer_profile_id] = (goalsById[g.scorer_profile_id] || 0) + 1
    if (g.assist_profile_id) assistsById[g.assist_profile_id] = (assistsById[g.assist_profile_id] || 0) + 1
  }
  const gaSuffix = (id) => {
    const parts = []
    if (goalsById[id]) parts.push(`${goalsById[id]}G`)
    if (assistsById[id]) parts.push(`${assistsById[id]}A`)
    return parts.length ? ` · ${parts.join(' ')}` : ''
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} aria-label={`${fixtureMatchup(f)} match report`}>
        <article className="match-report" data-team={f.team?.key}>
          <header className="mc-hero" style={{ backgroundImage: heroBackground({ pinnedUrl: f.pinnedUrl, pool, seed: f.id, gradient: grad }) }}>
            <div className="row spread">
              <span className="kicker poster-plate">Full time · {f.fixture_type}</span>
              {isAdmin && <button className="btn btn-ghost mc-edit" onClick={onEdit}>Edit</button>}
            </div>
            <div className="mt-3"><ScoreBug fixture={f} size="lg" /></div>
            <p className="report-dateline">
              {halfTimeScore(r) && <span>HT {halfTimeScore(r)}</span>}
              <time dateTime={f.match_date}>{fmtDateLong(f.match_date)}</time>
            </p>
          </header>

          {motm && (
            <section className="mc-motm">
              <div>
                <h2><IconCompetitions aria-hidden="true" />Man of the match</h2>
                <p className="report-award-name">{motm}</p>
                {motmSponsor && (
                  <div className="mc-motm-sponsor">
                    Sponsored by {motmSponsor.name}
                    {motmSponsor.logo_url && <ClubImage sizes="72px" src={motmSponsor.logo_url} alt="" />}
                  </div>
                )}
              </div>
              {r.motm_photo_url && (
                <button type="button" className="mc-motm-thumb" onClick={() => setZoom(true)}
                  aria-label={`Enlarge ${motm}'s photo`}>
                  <ClubImage sizes="144px" src={r.motm_photo_url} alt="" />
                </button>
              )}
            </section>
          )}

          <h2 className="report-heading">Goals</h2>
          {f.goals.length === 0 ? (
            <p className="dim mt-2" style={{ fontSize: 'var(--type-sm)' }}>{r.us === 0 ? 'No goals' : 'No scorers recorded'}</p>
          ) : (
            <ol className="mc-timeline" aria-label="Goal timeline">
              {f.goals.map((g, index) => {
                const scorer = resolveName(sb, g.scorer_profile_id, g.scorer_name) || 'Unknown'
                const assist = resolveName(sb, g.assist_profile_id, g.assist_name)
                return (
                  <li key={g.id ?? index} className="mc-goal">
                    <span className="mc-min mono">{g.minute != null ? `${g.minute}′` : '—'}</span>
                    <div className="mc-scorer">
                      <strong>{scorer}</strong>
                      {assist && <p>Assist · {assist}</p>}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}

          {squadState === 'error' ? <LoadIssue subject="the line-up" retry={() => setAttempt(n => n + 1)} />
            : squadState === 'loading' ? <p className="mt-3 muted" role="status">Loading the line-up…</p>
            : lineup ? (
            <>
              <h2 className="report-heading">Line-up</h2>
              <div className="mt-3">
                <PitchView teamKey={f.team?.key} formation={lineup.formation} starters={lineup.starters} names={lineNames} photos={linePhotos}
                  badge={(id) => (goalsById[id] ? `⚽${goalsById[id]}` : null)} />
              </div>
              {lineup.subs.length > 0 && (
                <div className="mt-3">
                  <h3 className="report-subs">Subs · {lineup.subs.length}</h3>
                  <ul className="mc-squad">
                    {lineup.subs.map((id) => <li key={id} className="mc-player">{lineNames[id] || '—'}{gaSuffix(id)}</li>)}
                  </ul>
                </div>
              )}
            </>
          ) : names.size > 0 ? (
            <>
              <h2 className="report-heading">The squad</h2>
              <ul className="mc-squad">
                {[...names].sort().map((n) => {
                  const t = tally[n]
                  return (
                    <li key={n} className="mc-player">
                      <span>{n}</span>
                      {t && <span className="mono mc-ga">{t.g ? `${t.g}G` : ''}{t.g && t.a ? ' · ' : ''}{t.a ? `${t.a}A` : ''}</span>}
                    </li>
                  )
                })}
              </ul>
            </>
          ) : null}

        </article>
      </Sheet>
      <Sheet open={Boolean(open && zoom && r.motm_photo_url)} onClose={() => setZoom(false)} aria-label={`${motm} photo`}>
        <figure className="report-photo">
          <ClubImage className="photo-viewer" sizes="(max-width: 780px) 100vw, 780px" src={r.motm_photo_url} alt={motm} />
          <figcaption>{motm} · Man of the match</figcaption>
        </figure>
      </Sheet>
    </>
  )
}
