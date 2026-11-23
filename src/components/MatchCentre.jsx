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
import { halfTimeScore } from '../lib/teams'

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
    <Sheet open={open} onClose={onClose}>
      <div className="mc-hero" style={{ backgroundImage: heroBackground({ pinnedUrl: f.pinnedUrl, pool, seed: f.id, gradient: grad }), backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <div className="row spread">
          <span className="kicker poster-plate">Full time · {f.fixture_type}</span>
          {isAdmin && <button className="btn btn-ghost mc-edit" onClick={onEdit}>Edit</button>}
        </div>
        <div className="mt-3"><ScoreBug fixture={f} size="lg" /></div>
        <p className="mono center mt-3" style={{ color: 'var(--on-photo-muted)', fontSize: 'var(--type-caption)' }}>
          {halfTimeScore(r) ? `HT ${halfTimeScore(r)} · ` : ''}{fmtDateLong(f.match_date)}
        </p>
      </div>

      {motm && (
        <div className="mc-motm mt-4">
          {r.motm_photo_url ? (
            <button type="button" className="mc-motm-thumb" onClick={() => setZoom(true)}
              aria-label={motm ? `Enlarge ${motm}'s photo` : 'Enlarge man of the match photo'}>
              <ClubImage sizes="64px" src={r.motm_photo_url} alt="" />
            </button>
          ) : (
            <span className="mc-star">★</span>
          )}
          <div className="grow">
            <span className="kicker">MAN OF THE MATCH</span>
            <div style={{ fontWeight: 600 }}>{motm}</div>
            {motmSponsor && (
              <div className="mc-motm-sponsor">
                sponsored by {motmSponsor.name}
                {motmSponsor.logo_url && <ClubImage sizes="64px" src={motmSponsor.logo_url} alt={motmSponsor.name} />}
              </div>
            )}
          </div>
        </div>
      )}

      {zoom && r.motm_photo_url && (
        <div className="mc-motm-zoom" role="dialog" aria-modal="true" onClick={() => setZoom(false)}>
          <img src={r.motm_photo_url} alt={motm ? `${motm} — man of the match` : 'Man of the match'} />
        </div>
      )}

      <p className="kicker mt-5"><span className="kicker-rule">GOALS</span></p>
      {f.goals.length === 0 ? (
        <p className="dim mt-2" style={{ fontSize: 'var(--type-sm)' }}>{r.us === 0 ? 'No goals' : 'No scorers recorded'}</p>
      ) : (
        <div className="mc-timeline mt-3">
          {f.goals.map((g, index) => {
            const scorer = resolveName(sb, g.scorer_profile_id, g.scorer_name) || 'Unknown'
            const assist = resolveName(sb, g.assist_profile_id, g.assist_name)
            return (
              <div key={g.id ?? index} className="mc-goal">
                <span className="mc-min mono">{g.minute != null ? `${g.minute}'` : '⚽'}</span>
                <span className="mc-dot" />
                <div>
                  <div style={{ fontWeight: 600 }}>{scorer}</div>
                  {assist && <div className="muted" style={{ fontSize: 'var(--type-sm)' }}>assist · {assist}</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {squadState === 'error' ? <LoadIssue subject="the line-up" retry={() => setAttempt(n => n + 1)} />
        : squadState === 'loading' ? <p className="mt-3 muted" role="status">Loading the line-up…</p>
        : lineup ? (
        <>
          <p className="kicker mt-5"><span className="kicker-rule">LINE-UP</span></p>
          <div className="mt-3">
            <PitchView teamKey={f.team?.key} formation={lineup.formation} starters={lineup.starters} names={lineNames} photos={linePhotos}
              badge={(id) => (goalsById[id] ? `⚽${goalsById[id]}` : null)} />
          </div>
          {lineup.subs.length > 0 && (
            <div className="mt-3">
              <p className="kicker" style={{ color: 'var(--bone-mute)' }}>SUBS · {lineup.subs.length}</p>
              <div className="row gap-2 mt-2" style={{ flexWrap: 'wrap' }}>
                {lineup.subs.map((id) => <span key={id} className="chip">{lineNames[id] || '—'}{gaSuffix(id)}</span>)}
              </div>
            </div>
          )}
        </>
      ) : names.size > 0 ? (
        <>
          <p className="kicker mt-5"><span className="kicker-rule">THE SQUAD</span></p>
          <div className="mc-squad mt-3">
            {[...names].sort().map((n) => {
              const t = tally[n]
              return (
                <div key={n} className="mc-player">
                  <span>{n}</span>
                  {t && <span className="mono mc-ga">{t.g ? `${t.g}G` : ''}{t.g && t.a ? ' · ' : ''}{t.a ? `${t.a}A` : ''}</span>}
                </div>
              )
            })}
          </div>
        </>
      ) : null}

      <style>{`
        .mc-hero { border-radius: var(--r-card); padding: var(--space-4); position: relative; }
        .mc-edit { padding: var(--space-1) var(--space-3); font-size: var(--type-sm); background: var(--photo-overlay); color: var(--on-photo); border-color: var(--photo-edge); }
        .mc-motm { display: flex; align-items: center; gap: var(--space-3); background: var(--slate);
          border: 1px solid var(--line); border-radius: var(--r-card); padding: var(--space-3) var(--space-3); }
        .mc-star { color: var(--gold); font-size: var(--type-title); }
        /* MOTM photo as a small avatar in the row; tap to enlarge. */
        .mc-motm-thumb { flex: none; width: 56px; height: 56px; border-radius: var(--r-card); padding: 0;
          overflow: hidden; border: 1.5px solid var(--gold); background: var(--slate); cursor: zoom-in; }
        .mc-motm-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .mc-motm-zoom { position: fixed; inset: 0; z-index: 210; background: var(--shadow-deep);
          display: flex; align-items: center; justify-content: center; padding: var(--space-6); cursor: zoom-out;
          animation: fade var(--t-fast); }
        .mc-motm-zoom img { max-width: 100%; max-height: 100%; border-radius: var(--r-card); object-fit: contain;
          box-shadow: var(--shadow-float, var(--shadow-deep)); }
        .mc-motm-sponsor { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-1);
          font-size: var(--type-xs); color: var(--bone-dim); }
        .mc-motm-sponsor img { height: 18px; width: auto; background: var(--bone); border-radius: var(--r-input); padding: var(--space-1) var(--space-1); }
        .mc-timeline { display: flex; flex-direction: column; }
        .mc-goal { display: grid; grid-template-columns: 40px 16px 1fr; align-items: center; gap: var(--space-2); padding: var(--space-2) 0; }
        .mc-min { color: var(--bone-mute); font-size: var(--type-sm); }
        .mc-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); justify-self: center; }
        .mc-squad { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-1) var(--space-4); }
        .mc-player { display: flex; justify-content: space-between; gap: var(--space-2); padding: var(--space-1) 0;
          border-bottom: 1px solid var(--line); font-size: var(--type-sm); }
        .mc-ga { color: var(--gold); font-size: var(--type-caption); }
        @media (max-width: 480px){ .mc-squad { grid-template-columns: 1fr; } }
      `}</style>
    </Sheet>
  )
}
