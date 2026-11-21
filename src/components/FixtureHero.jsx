import ClubImage from './ClubImage'
import { useEffect, useRef } from 'react'
import { motion, useMotionValue, useScroll, useSpring, useTransform, useReducedMotion } from 'framer-motion'
import { useDeviceTilt } from '../hooks/useDeviceTilt'
import { useDecorativeMotion } from '../hooks/useDecorativeMotion'
import AvailControl from './AvailControl'
import Crest from './Crest'
import WeatherStrip from './WeatherStrip'
import { fmtKO, parseDate } from '../lib/format'
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
  // Only add the extra text scrim over a real photo — branded gradient cards
  // already read fine and shouldn't be darkened.
  const hasPhoto = !!pickHeroImage({ pinnedUrl: f.pinnedUrl, pool, seed: f.id })

  // Signature poster motion (DESIGN-SYSTEM §5): a settle on arrival and a few
  // degrees of pointer tilt for depth on desktop. Disabled under reduced motion;
  // pointer tilt simply never fires on touch (no hover), which is fine.
  const reduce = useReducedMotion()
  const parallax = useDecorativeMotion()
  const px = useMotionValue(0.5), py = useMotionValue(0.5)
  const spring = { stiffness: 150, damping: 18 }
  const rotateX = useSpring(useTransform(py, [0, 1], [4.5, -4.5]), spring)
  const rotateY = useSpring(useTransform(px, [0, 1], [-4.5, 4.5]), spring)
  function onMove(e) {
    if (reduce) return
    const r = e.currentTarget.getBoundingClientRect()
    px.set((e.clientX - r.left) / r.width)
    py.set((e.clientY - r.top) / r.height)
  }
  function onLeave() { px.set(0.5); py.set(0.5) }

  // The same tilt, driven by the handset instead of a mouse. Pointer tilt never
  // fires on a phone (no hover), so without this the poster is flat on the
  // device the app actually lives on. Feeds the SAME springs, so there is one
  // tilt with two inputs rather than two competing effects.
  // Only the reading is wanted here. The iOS permission prompt is asked for by
  // the toggle in Profile (FeelSettings), because it has to come from a user
  // gesture and the hero is not the place to beg for one.
  const { tilt } = useDeviceTilt({ enabled: !reduce })
  useEffect(() => {
    if (!tilt) return
    px.set(0.5 + tilt.x / 2)
    py.set(0.5 + tilt.y / 2)
  }, [tilt, px, py])

  // Scroll parallax: the poster's image sits on its own overscanned layer and
  // travels against the scroll, so the card has a front and a back rather than
  // being one flat sticker. Transform-only, and the layer is inset far enough
  // that the travel never exposes an edge.
  const ref = useRef(null)

  return (
    <motion.div
      ref={ref}
      className={'hero' + (hasPhoto ? ' has-photo' : '')}
      style={{ rotateX, rotateY, transformPerspective: 1100 }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      initial={reduce ? false : { opacity: 0, scale: 0.985, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
    >
      <div className="hero-poster">
        {parallax
          ? <PosterDepth target={ref} image={bg} />
          : <div className="hero-bg" style={{ backgroundImage: bg }} />}
        <div className="hero-top">
          <span className="poster-plate">Next fixture</span>
          <span className="poster-plate">{f.home_away} · {f.fixture_type}</span>
          {isAdmin && <button className="hero-edit" onClick={onEdit} aria-label="Edit fixture">Edit</button>}
        </div>
        <div className="hero-info">
          <div className="hero-host">
            <Crest size={32} />
            <span className="hero-team-name">{matchName}</span>
            {matchName !== squad && <span className={'pill-first' + (!isXL ? ' community' : '')}>{squad}</span>}
          </div>
          <div className="hero-match">
            {f.opponent?.badge_url
              ? <ClubImage loading="eager" src={f.opponent.badge_url} alt="" width={32} height={32} />
              : <span className="hero-v" aria-hidden="true">v</span>}
            <h2 className="hero-opp">{f.opponent?.name}</h2>
          </div>
          <div className="hero-when">
            <div><span>{weekday}</span><time className="mono" dateTime={f.match_date}>{date}</time></div>
            <div><span>Kick-off</span><strong className="mono">{fmtKO(f.kickoff) || 'TBC'}</strong></div>
          </div>
          {f.venue && <p className="hero-venue"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>{f.venue}</p>}
          <WeatherStrip fixture={f} light detailed />
        </div>
      </div>

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
              {!blockReason && <div className="hero-you"><span>You</span><AvailControl value={f.myStatus} compact onChange={onSetAvail} /></div>}
            </>
          ) : !blockReason ? (
            <AvailControl heading="Your availability" value={f.myStatus} onChange={onSetAvail} />
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
    </motion.div>
  )
}

function PosterDepth({ target, image }) {
  const { scrollYProgress } = useScroll({ target, offset: ['start end', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 1], ['-7%', '7%'])
  return <motion.div className="hero-bg hero-parallax" style={{ backgroundImage: image, y }} />
}
