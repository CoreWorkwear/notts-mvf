import AvailControl from './AvailControl'
import WeatherStrip from './WeatherStrip'
import { fmtDate, fmtKO } from '../lib/format'
import { fixtureMatchup } from '../lib/teams'
import { respondBlockCopy } from '../lib/players'

// One upcoming game as a strip row: team-colour spine, the matchup (home team
// named first), tags, and the viewer's availability at a glance + settable
// inline. Admins see live counts instead of their own control.
// `blockReason` null = the viewer may answer; otherwise respondBlock()'s reason.
export default function FixtureStrip({ fixture, isAdmin, blockReason = null, onSetAvail, onOpen }) {
  const f = fixture
  const community = f.team?.key === 'community'
  const matchup = fixtureMatchup(f)

  return (
    <div className={'card spine strip' + (community ? ' community' : '')}>
      {/* When and who lead; home/away and competition are qualifiers and read as
          qualifiers. They used to be four identical grey boxes, so the kickoff
          time — the thing you actually scan a fixture list for — carried the
          same weight as the word "league". */}
      <button className="strip-main" onClick={onOpen}>
        <div className="strip-when mono">
          <span className="sw-date">{fmtDate(f.match_date)}</span>
          <span className="sw-ko">{fmtKO(f.kickoff)}</span>
        </div>
        <div className="strip-line">
          {matchup}
          {f.team?.is_first_team && <span className="pill-first">First Team</span>}
        </div>
        <div className="strip-meta mono">
          <span>{f.home_away}</span>
          <span className="sm-dot">·</span>
          <span>{f.fixture_type}</span>
        </div>
        <div className="strip-venue">{f.venue} <WeatherStrip fixture={f} /></div>
      </button>

      <div className="strip-side" onClick={(e) => e.stopPropagation()}>
        {isAdmin ? (
          <div className="strip-admin-side">
            <button className="strip-counts mono" onClick={onOpen}>
              <span className="sc in">{f.counts.in}</span>
              <span className="sc maybe">{f.counts.maybe}</span>
              <span className="sc no">{f.noReply}</span>
              <span className="sc-label">in · maybe · no reply</span>
            </button>
            {!blockReason && (
              <div className="strip-you">
                <span className="strip-you-lbl mono">You</span>
                <AvailControl value={f.myStatus} compact onChange={onSetAvail} />
              </div>
            )}
          </div>
        ) : !blockReason ? (
          <AvailControl value={f.myStatus} compact onChange={onSetAvail} />
        ) : (
          <span className="strip-locked mono">{respondBlockCopy(blockReason, f, { compact: true })}</span>
        )}
      </div>

      <style>{`
        /* A whole card that is tappable should say so on a pointer, and give
           under a finger. It did neither. */
        .strip { display: flex; align-items: stretch; padding: 0; overflow: hidden;
          transition: border-color var(--t-fast), transform var(--t-fast); }
        @media (hover: hover) and (pointer: fine) {
          .strip:hover { border-color: var(--line-2); }
        }
        .strip:active { transform: scale(.995); }
        .strip-main { flex: 1; text-align: left; background: none; border: none; color: var(--bone);
          padding: 13px 14px 14px 18px; display: flex; flex-direction: column; gap: 5px; }
        /* The scan line: date bright, kickoff beside it, both mono so a column of
           rows aligns. */
        .strip-when { display: flex; align-items: baseline; gap: 8px; font-size: 12px; letter-spacing: .04em; }
        .sw-date { color: var(--bone); font-weight: 500; text-transform: uppercase; }
        .sw-ko { color: var(--bone-mute); }
        .strip-line { font-family: var(--font-display); font-weight: 600; font-size: 18px; line-height: 1.05;
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        /* Linear register: a squared outline tag, not a 999px badge. */
        .pill-first { font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: .06em;
          text-transform: uppercase; color: var(--red-bright); background: transparent;
          border: 1px solid var(--red); border-radius: 5px; padding: 2px 6px; }
        .strip-meta { display: flex; flex-wrap: wrap; gap: 5px; font-size: 11px; color: var(--bone-mute);
          letter-spacing: .04em; text-transform: uppercase; }
        .sm-dot { color: var(--bone-dim); }
        .strip-venue { font-size: 12px; color: var(--bone-mute); }
        .strip-side { display: flex; align-items: center; padding: 12px 14px; border-left: 1px solid var(--line); }
        .strip-locked { font-size: 11px; color: var(--bone-mute); max-width: 90px; line-height: 1.2; }
        .strip-admin-side { display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
        .strip-you { display: flex; align-items: center; gap: 8px; }
        .strip-you-lbl { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--bone-mute); }
        .strip-counts { background: none; border: none; display: grid;
          grid-template-columns: repeat(3, auto); gap: 0 10px; align-items: center; color: var(--bone); }
        .strip-counts .sc { font-size: 19px; font-weight: 600; }
        .sc.in { color: var(--green-bright); } .sc.maybe { color: var(--amber); } .sc.no { color: var(--bone-mute); }
        .sc-label { grid-column: 1 / -1; font-size: 10px; color: var(--bone-mute); letter-spacing: .06em;
          text-transform: uppercase; margin-top: 2px; }
        @media (max-width: 520px) {
          .strip { flex-direction: column; }
          .strip-side { border-left: none; border-top: 1px solid var(--line); padding: 12px 14px 14px 18px; }
        }
      `}</style>
    </div>
  )
}
