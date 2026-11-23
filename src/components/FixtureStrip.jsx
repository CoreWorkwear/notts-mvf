import AvailControl from './AvailControl'
import WeatherStrip from './WeatherStrip'
import { parseDate, fmtKO } from '../lib/format'
import { teamLabel, fixtureMatchup } from '../lib/teams'
import { respondBlockCopy } from '../lib/players'

// One upcoming game as a strip row: team-colour spine, the matchup (home team
// named first), tags, and the viewer's availability at a glance + settable
// inline. Admins see live counts instead of their own control.
// `blockReason` null = the viewer may answer; otherwise respondBlock()'s reason.
export default function FixtureStrip({ fixture, isAdmin, blockReason = null, onSetAvail, onOpen, onOpenWhosIn = onOpen }) {
  const blockedMessage = blockReason && respondBlockCopy(blockReason, { compact: true })
  const f = fixture
  const community = f.team?.key === 'community'
  const matchup = fixtureMatchup(f)
  const date = parseDate(f.match_date)

  return (
    <div className={'card spine strip' + (community ? ' community' : '')}>
      <button className="strip-main" onClick={onOpen}>
        <time className="strip-date" dateTime={f.match_date}>
          <b className="mono">{String(date.getDate()).padStart(2, '0')}</b>
          <span>{date.toLocaleDateString('en-GB', { month: 'short' })}</span>
        </time>
        <span className="strip-summary">
          <span className="strip-team"><span className="status-light" aria-hidden="true" />{teamLabel(f.team)}</span>
          <strong className="strip-line">{matchup}</strong>
          <span className="strip-meta">{f.home_away} · <span className="mono">{fmtKO(f.kickoff) || 'TBC'}</span></span>
          <WeatherStrip fixture={f} />
        </span>
        <span className="strip-more" aria-hidden="true">›</span>
      </button>

      {(isAdmin || !blockReason || blockedMessage) && (
        <div className="strip-side" onClick={(e) => e.stopPropagation()}>
          {isAdmin ? (
            <div className="strip-admin-side">
              {/* Each figure carries its OWN caption. The three numbers used to sit
                  in auto-width grid columns above a single "in · maybe · no reply"
                  text run, so they never actually lined up with the words — the 3rd
                  number sat over the gap before its label. Pairing them makes the
                  alignment structural rather than a coincidence of string widths. */}
              <button className="strip-counts" onClick={onOpenWhosIn} aria-label="See who's in">
                <span className="sc-col">
                  <span className="sc mono in">{f.counts.in}</span>
                  <span className="sc-cap">in</span>
                </span>
                <span className="sc-col">
                  <span className="sc mono maybe">{f.counts.maybe}</span>
                  <span className="sc-cap">maybe</span>
                </span>
                <span className="sc-col">
                  <span className="sc mono no">{f.noReply}</span>
                  <span className="sc-cap">no reply</span>
                </span>
              </button>
              {!blockReason && (
                <div className="strip-you">
                  <span className="strip-you-lbl">You</span>
                  <AvailControl value={f.myStatus} pending={f.availabilityPending} compact onChange={onSetAvail} />
                </div>
              )}
            </div>
          ) : !blockReason ? (
            <AvailControl value={f.myStatus} pending={f.availabilityPending} compact onChange={onSetAvail} />
          ) : (
            <span className="strip-locked">{blockedMessage}</span>
          )}
        </div>
      )}

    </div>
  )
}
