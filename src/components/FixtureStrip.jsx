import AvailControl from './AvailControl'
import WeatherStrip from './WeatherStrip'
import { fmtDate, fmtKO } from '../lib/format'

// One upcoming game as a strip row: team-colour spine, the matchup (home team
// named first), tags, and the viewer's availability at a glance + settable
// inline. Admins see live counts instead of their own control.
export default function FixtureStrip({ fixture, isAdmin, onSetAvail, onOpen }) {
  const f = fixture
  const community = f.team?.key === 'community'
  const us = f.team?.label
  const them = f.opponent?.name
  const matchup = f.home_away === 'Home' ? `${us} v ${them}` : `${them} v ${us}`

  return (
    <div className={'card spine strip' + (community ? ' community' : '')}>
      <button className="strip-main" onClick={onOpen}>
        <div className="strip-line">{matchup}</div>
        <div className="strip-tags mono">
          <span>{fmtDate(f.match_date)}</span>
          <span>{fmtKO(f.kickoff)}</span>
          <span>{f.home_away}</span>
          <span>{f.fixture_type}</span>
        </div>
        <div className="strip-venue">{f.venue} <WeatherStrip fixture={f} /></div>
      </button>

      <div className="strip-side" onClick={(e) => e.stopPropagation()}>
        {isAdmin ? (
          <button className="strip-counts mono" onClick={onOpen}>
            <span className="sc in">{f.counts.in}</span>
            <span className="sc maybe">{f.counts.maybe}</span>
            <span className="sc no">{f.noReply}</span>
            <span className="sc-label">in · maybe · left</span>
          </button>
        ) : (
          <AvailControl value={f.myStatus} compact onChange={onSetAvail} />
        )}
      </div>

      <style>{`
        .strip { display: flex; align-items: stretch; padding: 0; overflow: hidden; }
        .strip-main { flex: 1; text-align: left; background: none; border: none; color: var(--bone);
          padding: 14px 14px 14px 18px; display: flex; flex-direction: column; gap: 6px; }
        .strip-line { font-family: var(--font-display); font-weight: 600; font-size: 18px; line-height: 1.05; }
        .strip-tags { display: flex; flex-wrap: wrap; gap: 6px; font-size: 11px; color: var(--bone-mute); }
        .strip-tags span { background: var(--slate); border-radius: 6px; padding: 2px 7px; letter-spacing: .03em; }
        .strip-venue { font-size: 12px; color: var(--bone-dim); }
        .strip-side { display: flex; align-items: center; padding: 12px 14px; border-left: 1px solid var(--line); }
        .strip-counts { background: none; border: none; display: grid;
          grid-template-columns: repeat(3, auto); gap: 0 10px; align-items: center; color: var(--bone); }
        .strip-counts .sc { font-size: 19px; font-weight: 600; }
        .sc.in { color: var(--green-bright); } .sc.maybe { color: var(--amber); } .sc.no { color: var(--bone-dim); }
        .sc-label { grid-column: 1 / -1; font-size: 9px; color: var(--bone-dim); letter-spacing: .06em;
          text-transform: uppercase; margin-top: 2px; }
        @media (max-width: 520px) {
          .strip { flex-direction: column; }
          .strip-side { border-left: none; border-top: 1px solid var(--line); padding: 12px 14px 14px 18px; }
        }
      `}</style>
    </div>
  )
}
