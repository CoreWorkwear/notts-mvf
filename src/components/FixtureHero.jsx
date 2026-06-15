import AvailControl from './AvailControl'
import Crest from './Crest'
import WeatherStrip from './WeatherStrip'
import { fmtDateLong, fmtKO, relativeWhen } from '../lib/format'
import { heroBackground } from '../lib/media'

// The next-game hero — an ACTION surface (DESIGN-SYSTEM §6.1 / UX-AND-IA §1).
// Player: in/maybe/out inline, the lead. Manager: squad state leads, tappable
// to who's-in; their own in/out is still there but secondary.
export default function FixtureHero({ fixture, isAdmin, canRespond = true, pool = [], onSetAvail, onOpenWhosIn, onEdit }) {
  const f = fixture
  const isXL = f.team?.key === 'xl'
  const grad = isXL ? 'var(--grad-xl)' : 'var(--grad-community)'
  const bg = heroBackground({ pinnedUrl: f.pinnedUrl, pool, seed: f.id, gradient: grad })

  return (
    <div className="hero" style={{ backgroundImage: bg }}>
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
      <p className="hero-meta mono">
        {f.team?.label} · {f.home_away} · {f.fixture_type}
      </p>
      <p className="hero-when mono">{fmtDateLong(f.match_date)} · {fmtKO(f.kickoff)} KO · {f.venue}</p>
      <div className="mt-2"><WeatherStrip fixture={f} light detailed /></div>

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

      <style>{`
        .hero {
          position: relative; overflow: hidden;
          border-radius: var(--r-hero);
          padding: 18px;
          background-size: cover; background-position: center;
          color: #fff;
          box-shadow: 0 18px 40px -20px rgba(0,0,0,.9);
        }
        .hero-top { display: flex; justify-content: space-between; align-items: center; }
        .hero-edit { background: rgba(0,0,0,.25); border: 1px solid rgba(255,255,255,.25); color: #fff;
          border-radius: 9px; padding: 5px 12px; font-size: 13px; font-weight: 600; }
        .hero-match { display: flex; align-items: center; gap: 12px; margin-top: 18px; }
        .hero-v { font-family: var(--font-serif); font-size: 22px; font-style: italic; opacity: .85; }
        .hero-monogram { width: 34px; height: 34px; border-radius: 8px; display: grid; place-items: center;
          border: 1.5px dashed rgba(255,255,255,.5); font-weight: 700; }
        .hero-opp { font-size: clamp(34px, 11vw, 56px); line-height: .92; margin-top: 8px; }
        .hero-meta { font-size: 12px; letter-spacing: .04em; text-transform: uppercase; opacity: .9; margin-top: 8px; }
        .hero-when { font-size: 13px; opacity: .92; margin-top: 4px; }
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
      `}</style>
    </div>
  )
}
