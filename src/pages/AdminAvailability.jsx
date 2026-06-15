import { useState } from 'react'
import { useSeason } from '../context/SeasonContext'
import { useFixtures } from '../hooks/useFixtures'
import { fmtDate, fmtKO } from '../lib/format'
import { fixtureMatchup } from '../lib/teams'
import WhosInSheet from '../components/WhosInSheet'
import Loader from '../components/Loader'

// Who's In (admin): every upcoming game at a glance with in/maybe/no-reply
// counts; tap one for the full team-sheet + chase (UX-AND-IA §3).
export default function AdminAvailability() {
  const { seasonId } = useSeason()
  const { upcoming, loading, fixtures } = useFixtures(seasonId)
  const [open, setOpen] = useState(null)

  if (loading && fixtures.length === 0) return <Loader label="Counting heads…" />

  return (
    <div className="page">
      <p className="kicker"><span className="kicker-rule">WHO'S IN</span></p>
      <h1 className="display mt-2" style={{ fontSize: 28 }}>Who's about</h1>

      {upcoming.length === 0 ? (
        <div className="empty mt-5">
          <p className="empty-title">No games to chase</p>
          <p>Set a fixture and you'll see who's in, who's maybe, and who's gone quiet.</p>
        </div>
      ) : (
        <div className="col gap-2 mt-4 stagger">
          {upcoming.map((f) => {
            const community = f.team?.key === 'community'
            return (
              <button key={f.id} className={'card spine wi-row' + (community ? ' community' : '')} onClick={() => setOpen(f)}>
                <div className="wi-main">
                  <div className="wi-match">{fixtureMatchup(f)}</div>
                  <div className="mono wi-when">{fmtDate(f.match_date)} · {fmtKO(f.kickoff)}</div>
                </div>
                <div className="wi-counts mono">
                  <span className="in">{f.counts.in}</span>
                  <span className="maybe">{f.counts.maybe}</span>
                  <span className="no">{f.noReply}</span>
                  <span className="wi-lbl">in · maybe · left</span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      <WhosInSheet open={!!open} fixture={open} onClose={() => setOpen(null)} />

      <style>{`
        .wi-row { display: flex; align-items: center; gap: 12px; padding: 14px 14px 14px 18px;
          background: var(--coal); color: var(--bone); text-align: left; border: 1px solid var(--line); }
        .wi-main { flex: 1; }
        .wi-match { font-family: var(--font-display); font-weight: 600; font-size: 17px; line-height: 1.1; }
        .wi-when { font-size: 12px; color: var(--bone-mute); margin-top: 4px; }
        .wi-counts { display: grid; grid-template-columns: repeat(3, auto); gap: 0 10px; align-items: center; }
        .wi-counts span { font-size: 19px; font-weight: 600; }
        .wi-counts .in { color: var(--green-bright); } .wi-counts .maybe { color: var(--amber); } .wi-counts .no { color: var(--bone-dim); }
        .wi-lbl { grid-column: 1 / -1; font-size: 9px; color: var(--bone-dim); letter-spacing: .06em;
          text-transform: uppercase; margin-top: 2px; }
      `}</style>
    </div>
  )
}
