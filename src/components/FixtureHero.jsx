import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'framer-motion'
import AvailControl from './AvailControl'
import Crest from './Crest'
import WeatherStrip from './WeatherStrip'
import { fmtDateLong, fmtKO, relativeWhen } from '../lib/format'
import { heroBackground, pickHeroImage } from '../lib/media'
import { teamMatchName } from '../lib/teams'

// The next-game hero — an ACTION surface (DESIGN-SYSTEM §6.1 / UX-AND-IA §1).
// Player: in/maybe/out inline, the lead. Manager: squad state leads, tappable
// to who's-in; their own in/out is still there but secondary.
export default function FixtureHero({ fixture, isAdmin, canRespond = true, pool = [], onSetAvail, onOpenWhosIn, onOpenDetail, onEdit }) {
  const f = fixture
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

  return (
    <motion.div
      className={'hero' + (hasPhoto ? ' has-photo' : '')}
      style={{ backgroundImage: bg, rotateX, rotateY, transformPerspective: 1100 }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      initial={reduce ? false : { opacity: 0, scale: 0.985, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
    >
      <div className="hero-top">
        <span className="kicker" style={{ color: 'rgba(255,255,255,.85)' }}>NEXT UP · {relativeWhen(f.match_date)}</span>
        {isAdmin && (
          <button className="hero-edit" onClick={onEdit} aria-label="Edit fixture">Edit</button>
        )}
      </div>

      <div className="hero-match">
        <Crest size={34} />
        <span className="hero-v">v</span>
        {f.opponent?.badge_url
          ? <img src={f.opponent.badge_url} alt="" width={34} height={34} style={{ borderRadius: 8 }} />
          : <span className="hero-monogram">{(f.opponent?.name || '?').slice(0, 1)}</span>}
      </div>

      <h2 className="hero-opp display">{f.opponent?.name}</h2>
      <div className="hero-info">
        <p className="hero-meta mono">
          {teamMatchName(f.team)}{f.team?.is_first_team && <span className="pill-first">First Team</span>} · {f.home_away} · {f.fixture_type}
        </p>
        <p className="hero-when mono">{fmtDateLong(f.match_date)} · {fmtKO(f.kickoff)} KO</p>
        <p className="hero-venue mono">{f.venue}</p>
        <div className="mt-2"><WeatherStrip fixture={f} light detailed /></div>
      </div>

      <div className="hero-action">
        {isAdmin ? (
          <>
            <button className="squad-state" onClick={onOpenWhosIn}>
              <span className="ss-counts mono">
                <b>{f.counts.in}</b> in · <b>{f.counts.maybe}</b> maybe · <b>{f.noReply}</b> not replied
              </span>
              <span className="ss-cta">See who's in →</span>
            </button>
            {canRespond && (
              <div className="hero-you">
                <span className="hero-you-lbl mono">You</span>
                <AvailControl value={f.myStatus} compact onChange={onSetAvail} />
              </div>
            )}
          </>
        ) : canRespond ? (
          <>
            <span className="kicker" style={{ color: 'rgba(255,255,255,.85)' }}>YOU IN?</span>
            <div className="mt-2">
              <AvailControl value={f.myStatus} unanswered onChange={onSetAvail} />
            </div>
          </>
        ) : (
          <span style={{ fontSize: 14, opacity: .9 }}>Availability opens once the manager signs you off.</span>
        )}
      </div>

      {onOpenDetail && (
        <button className="hero-detail" onClick={onOpenDetail}>Match details &amp; line-up →</button>
      )}

      <style>{`
        .hero {
          position: relative; overflow: hidden;
          border-radius: var(--r-hero);
          padding: 18px;
          background-size: cover; background-position: center;
          color: #fff;
          box-shadow: 0 18px 40px -20px rgba(0,0,0,.9);
        }
        /* Over a busy action photo: a soft rounded box behind the detail lines
           (team · home/away · type · date · KO · venue · weather) so they stay
           legible, plus a light shadow on the big name. Photos only — branded
           gradient cards are left clean. */
        .hero.has-photo .hero-info {
          display: inline-block; margin-top: 8px;
          background: rgba(8, 10, 9, .40); backdrop-filter: blur(3px);
          border-radius: 12px; padding: 8px 12px;
        }
        .hero.has-photo .hero-info .hero-meta,
        .hero.has-photo .hero-info .hero-when { margin-top: 0; }
        .hero.has-photo .hero-info .hero-when { margin-top: 4px; }
        .hero.has-photo .hero-opp { text-shadow: 0 2px 12px rgba(0,0,0,.55); }
        .hero-top { display: flex; justify-content: space-between; align-items: center; }
        .hero-edit { background: rgba(0,0,0,.25); border: 1px solid rgba(255,255,255,.25); color: #fff;
          border-radius: 9px; padding: 5px 12px; font-size: 13px; font-weight: 600; }
        .hero-match { display: flex; align-items: center; gap: 12px; margin-top: 18px; }
        .hero-v { font-family: var(--font-serif); font-size: 22px; font-style: italic; opacity: .85; }
        .hero-monogram { width: 34px; height: 34px; border-radius: 8px; display: grid; place-items: center;
          border: 1.5px dashed rgba(255,255,255,.5); font-weight: 700; }
        .hero-opp { font-size: clamp(34px, 11vw, 56px); line-height: .92; margin-top: 8px; }
        .hero-meta { font-size: 12px; letter-spacing: .04em; text-transform: uppercase; opacity: .9; margin-top: 8px; }
        .hero-meta .pill-first { font-size: 11px; font-weight: 700; background: rgba(0,0,0,.38);
          border: 1px solid rgba(255,255,255,.4); border-radius: 999px; padding: 2px 8px; margin-left: 6px; }
        .hero-when { font-size: 13px; opacity: .92; margin-top: 4px; }
        .hero-venue { font-size: 13px; opacity: .82; margin-top: 2px; }
        .hero-action { margin-top: 18px; background: rgba(0,0,0,.28); border-radius: 14px; padding: 14px;
          backdrop-filter: blur(4px); }
        .squad-state { width: 100%; display: flex; flex-direction: column; gap: 6px; align-items: flex-start;
          background: none; border: none; color: #fff; text-align: left; }
        .ss-counts { font-size: 17px; }
        .ss-counts b { font-weight: 600; }
        .ss-cta { font-size: 13px; opacity: .85; }
        .hero-you { display: flex; align-items: center; gap: 10px; margin-top: 12px; padding-top: 12px;
          border-top: 1px solid rgba(255,255,255,.18); flex-wrap: wrap; }
        .hero-you-lbl { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; opacity: .85; }
        .hero-detail { width: 100%; margin-top: 12px; background: rgba(0,0,0,.28); border: 1px solid rgba(255,255,255,.18);
          color: #fff; border-radius: 12px; padding: 10px; font-size: 13px; font-weight: 600; backdrop-filter: blur(4px); }
      `}</style>
    </motion.div>
  )
}
