import { useState } from 'react'
import { useSeason } from '../context/SeasonContext'
import { useFixtures } from '../hooks/useFixtures'
import { fmtDate, fmtKO, todayISO, addDaysISO } from '../lib/format'
import { fixtureMatchup } from '../lib/teams'
import WhosInSheet from '../components/WhosInSheet'
import Loader from '../components/Loader'
import PageHead from '../components/PageHead'
import LoadIssue from '../components/LoadIssue'

// How long a played game stays reachable here for its subs and CSV.
const SUBS_WINDOW_DAYS = 14

// Who's In (admin): every upcoming game at a glance with in/maybe/no-reply
// counts; tap one for the full team-sheet + chase (UX-AND-IA §3). Games played
// in the last fortnight stay listed below, because the subs tick-list and the
// CSV live in the same sheet and are mostly needed AFTER the match.
export default function AdminAvailability() {
  const { season, seasonId, loading: seasonLoading, error: seasonError, refreshSeasons } = useSeason()
  const { upcoming, loading, error, fixtures, refetch } = useFixtures(seasonId, season?.label)
  const [open, setOpen] = useState(null)

  // A P-P game has nothing to chase — it sits in Results as postponed, not here.
  const toChase = upcoming.filter((f) => !f.postponed)
  // Played = result logged, or kickoff + 4h gone. Exactly the games `upcoming`
  // has just dropped, so nothing shows twice and nothing falls between the two.
  const since = addDaysISO(todayISO(), -SUBS_WINDOW_DAYS)
  const played = fixtures
    .filter((f) => !f.postponed && (f.concluded || f.hasResult) && f.match_date >= since)
    .sort((a, b) => (a.match_date < b.match_date ? 1 : a.match_date > b.match_date ? -1 : (b.kickoff ?? '').localeCompare(a.kickoff ?? '')))

  if (!seasonId && seasonError) return <div className="page"><LoadIssue subject="the seasons" retry={refreshSeasons} /></div>
  if ((!seasonId && seasonLoading) || (loading && fixtures.length === 0)) return <Loader route="whos-in" label="Loading availability…" />

  // A failed first load is not "no games to chase" — say so and offer a retry
  // (same shape as Fixtures). With fixtures already on screen, keep them.
  if (error && fixtures.length === 0) return (
    <div className="page">
      <div className="empty mt-5" role="alert">
        <p className="empty-title">Couldn't load fixtures</p>
        <button className="btn btn-primary mt-3" onClick={refetch}>Try again</button>
      </div>
    </div>
  )

  return (
    <div className="page">
      <PageHead title="Who's in" />
      {error && <p className="dim mt-2" role="status" style={{ fontSize: 'var(--type-sm)' }}>Couldn't refresh fixtures. Showing saved fixtures.</p>}

      {toChase.length === 0 ? (
        <div className="empty mt-5">
          <p className="empty-title">No upcoming fixtures</p>
        </div>
      ) : (
        <div className="col gap-2 mt-4">
          {toChase.map((f) => {
            const community = f.team?.key === 'community'
            return (
              <button key={f.id} className={'card spine wi-row' + (community ? ' community' : '')} style={{ width: '100%' }} onClick={() => setOpen(f)}>
                <div className="wi-main">
                  <div className="wi-match">{fixtureMatchup(f)}</div>
                  <div className="mono wi-when">{fmtDate(f.match_date)} · {fmtKO(f.kickoff)}</div>
                </div>
                <div className="wi-counts">
                  <span><b className="in mono">{f.counts.in}</b> In</span>
                  <span><b className="maybe mono">{f.counts.maybe}</b> Maybe</span>
                  <span><b className="no mono">{f.noReply}</b> No reply</span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {played.length > 0 && (
        <div className="mt-5">
          <p className="kicker" style={{ color: 'var(--bone-mute)' }}>RECENTLY PLAYED</p>
          <div className="col gap-2 mt-2">
            {played.map((f) => (
              <button key={f.id} className={'card spine wi-row' + (f.team?.key === 'community' ? ' community' : '')} style={{ width: '100%' }} onClick={() => setOpen(f)}>
                <div className="wi-main">
                  <div className="wi-match">{fixtureMatchup(f)}</div>
                  <div className="mono wi-when">{fmtDate(f.match_date)} · {fmtKO(f.kickoff)}</div>
                </div>
                <span className="wi-subs">Subs</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <WhosInSheet open={!!open} fixture={open} onClose={() => setOpen(null)} />

      <style>{`
        .wi-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
          background: var(--coal); color: var(--bone); text-align: left; border: 1px solid var(--line); }
        .wi-main { flex: 1 1 10rem; min-width: 0; overflow-wrap: anywhere; }
        .wi-match { font-family: var(--font-display); font-weight: 600; font-size: var(--type-lead); line-height: 1.1; }
        .wi-when { font-size: var(--type-caption); color: var(--bone-mute); margin-top: var(--space-1); }
        .wi-counts { display: flex; flex-wrap: wrap; gap: var(--space-2); font-size: var(--type-xs); color: var(--text-muted); }
        .wi-counts > span { display: grid; text-align: center; }
        .wi-counts .in, .wi-counts .maybe, .wi-counts .no { font-size: var(--type-lg); font-weight: 600; }
        .wi-counts .in { color: var(--green-bright); } .wi-counts .maybe { color: var(--amber); } .wi-counts .no { color: var(--bone-mute); }
        .wi-subs { font-size: var(--type-caption); color: var(--bone-mute); letter-spacing: .06em; text-transform: uppercase; }
        .wi-lbl { grid-column: 1 / -1; font-size: var(--type-xs); color: var(--bone-mute); letter-spacing: .06em;
          text-transform: uppercase; margin-top: var(--space-1); }
      `}</style>
    </div>
  )
}
