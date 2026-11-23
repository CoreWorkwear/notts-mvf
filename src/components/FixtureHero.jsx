import ClubImage from './ClubImage'
import { useCallback, useRef } from 'react'
import { motion, useSpring, useReducedMotion } from 'framer-motion'
import { SPRING_DRIFT } from '../lib/motion'
import { useDeviceTilt } from '../hooks/useDeviceTilt'
import { useDecorativeMotion } from '../hooks/useDecorativeMotion'
import AvailControl from './AvailControl'
import Crest from './Crest'
import WeatherStrip from './WeatherStrip'
import { fmtKO, parseDate, relativeWhen } from '../lib/format'
import { IconWhosIn } from './Icons'
import { heroBackground, pickHeroImage } from '../lib/media'
import { teamLabel, teamMatchName } from '../lib/teams'
import { respondBlockCopy } from '../lib/players'

// The next-game hero — an ACTION surface (DESIGN-SYSTEM §6.1 / UX-AND-IA §1).
// Player: in/maybe/out inline, the lead. Manager: squad state leads, tappable
// to who's-in; their own in/out is still there but secondary.
// `blockReason` is null when the viewer may answer this game, otherwise the
// reason from respondBlock() — squad, account state or kickoff (0034).
export default function FixtureHero({ fixture, isAdmin, blockReason = null, pool = [], onSetAvail, onOpenWhosIn, onOpenDetail, onOpenLineup, onEdit }) {
  const blockedMessage = blockReason && respondBlockCopy(blockReason)
  const f = fixture
  const matchName = teamMatchName(f.team)
  const squad = teamLabel(f.team)
  const day = parseDate(f.match_date)
  const weekday = day.toLocaleDateString('en-GB', { weekday: 'long' })
  const date = day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const isXL = f.team?.key === 'xl'
  const grad = isXL ? 'var(--grad-xl)' : 'var(--grad-community)'
  const bg = heroBackground({ pinnedUrl: f.pinnedUrl, pool, seed: f.id, gradient: grad })
  const hasPhoto = !!pickHeroImage({ pinnedUrl: f.pinnedUrl, pool, seed: f.id })

  return (
    <article className={'hero' + (hasPhoto ? ' has-photo' : '')} data-side={isXL ? 'xl' : 'community'}>
      <Poster image={bg}>
        <div className="hero-top">
          <span className="poster-plate">Next fixture · {relativeWhen(f.match_date)}</span>
          {isAdmin && <button className="hero-edit" onClick={onEdit} aria-label="Edit fixture">Edit</button>}
        </div>
        <div className="hero-info">
          <div className="hero-host">
            <Crest size={32} />
            <span className="hero-team-name">{matchName}</span>
            {matchName !== squad && <span className={'pill-first' + (!isXL ? ' community' : '')}>{squad}</span>}
            <span className="hero-versus"><span aria-hidden="true">v</span><span className="sr-only">versus</span></span>
          </div>
          <div className="hero-match">
            {f.opponent?.badge_url
              ? <ClubImage loading="eager" src={f.opponent.badge_url} alt="" width={32} height={32} />
              : null}
            <h2 className="hero-opp">{f.opponent?.name}</h2>
          </div>
          <p className="hero-competition">{f.home_away} · {f.fixture_type}</p>
          <div className="hero-when">
            <div><span>{weekday}</span><time className="mono" dateTime={f.match_date}>{date}</time></div>
            <div><span>Kick-off</span><strong className="mono">{fmtKO(f.kickoff) || 'TBC'}</strong></div>
          </div>
          {f.venue && <p className="hero-venue"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>{f.venue}</p>}
          <WeatherStrip fixture={f} light detailed />
        </div>
      </Poster>

      {(isAdmin || !blockReason || blockedMessage) && (
        <div className="hero-action">
          {isAdmin ? (
            <>
              <button className="squad-state" onClick={onOpenWhosIn}>
                <span className="ss-counts">
                  <b className="mono">{f.counts.in}</b> in · <b className="mono">{f.counts.maybe}</b> maybe · <b className="mono">{f.noReply}</b> not replied
                </span>
                <span className="ss-cta">See who's in →</span>
              </button>
              {f.rosterSize > 0 && <div className="squad-meter" role="meter" aria-label="Squad replies"
                aria-valuemin={0} aria-valuemax={f.rosterSize} aria-valuenow={f.replied}
                aria-valuetext={`${f.replied} of ${f.rosterSize} players have replied`}>
                <span style={{ transform: `scaleX(${f.replied / f.rosterSize})` }} />
              </div>}
              {!blockReason && <div className="hero-you"><span>You</span><AvailControl value={f.myStatus} pending={f.availabilityPending} compact onChange={onSetAvail} /></div>}
            </>
          ) : !blockReason ? (
            <AvailControl heading="Your availability" value={f.myStatus} pending={f.availabilityPending} onChange={onSetAvail} />
          ) : (
            <span className="availability-locked">{blockedMessage}</span>
          )}
        </div>
      )}

      <div className="hero-links">
        {!isAdmin && onOpenWhosIn && <button className="hero-detail" onClick={onOpenWhosIn}><IconWhosIn aria-hidden="true" width={16} height={16} /> Who's in</button>}
        {onOpenDetail && <button className="hero-detail" onClick={onOpenDetail}>{isAdmin ? 'Match details' : 'Match details & line-up'} <span aria-hidden="true">→</span></button>}
        {onOpenLineup && <button className="hero-detail" onClick={onOpenLineup}>Line-up <span aria-hidden="true">→</span></button>}
      </div>
    </article>
  )
}

function Poster({ image, children }) {
  const reduce = useReducedMotion()
  const pointerDepth = useDecorativeMotion()
  const bounds = useRef(null)
  const x = useSpring(0, SPRING_DRIFT)
  const y = useSpring(0, SPRING_DRIFT)
  const move = useCallback((dx, dy) => { x.set(dx * 5); y.set(dy * 5) }, [x, y])
  useDeviceTilt({ enabled: !reduce, onSample: move })

  return <div className="hero-poster"
    onPointerEnter={pointerDepth ? e => { bounds.current = e.currentTarget.getBoundingClientRect() } : undefined}
    onPointerMove={pointerDepth ? e => {
      const box = bounds.current
      if (box && e.pointerType === 'mouse') move((e.clientX - box.left) / box.width * 2 - 1, (e.clientY - box.top) / box.height * 2 - 1)
    } : undefined}
    onPointerLeave={pointerDepth ? () => move(0, 0) : undefined}>
    <motion.div className="hero-bg" style={{ backgroundImage: image, x: reduce ? 0 : x, y: reduce ? 0 : y }} />
    {children}
  </div>
}
