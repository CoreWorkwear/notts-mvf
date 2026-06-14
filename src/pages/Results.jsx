import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useSeason } from '../context/SeasonContext'
import { useResults, outcome } from '../hooks/useResults'
import { fmtDate } from '../lib/format'
import ScoreBug from '../components/ScoreBug'
import MatchCentre from '../components/MatchCentre'
import ResultForm from '../components/ResultForm'
import Loader from '../components/Loader'

const OUTCOME_LABEL = { W: 'Won', D: 'Drawn', L: 'Lost' }

export default function Results() {
  const { isAdmin } = useAuth()
  const { seasonId } = useSeason()
  const { played, needsResult, postponed, squad, loading, refetch } = useResults(seasonId)
  const [centre, setCentre] = useState(null)   // fixture for match centre
  const [editing, setEditing] = useState(null) // fixture for result form

  if (loading && played.length === 0 && needsResult.length === 0 && postponed.length === 0) return <Loader label="Fetching the results…" />

  const [latest, ...earlier] = played

  return (
    <div className="page">
      <p className="kicker"><span className="kicker-rule">FULL TIME</span></p>
      <h1 className="display mt-2" style={{ fontSize: 28 }}>Results</h1>

      {/* Admin: games still needing a result */}
      {isAdmin && needsResult.length > 0 && (
        <div className="mt-4">
          <p className="kicker" style={{ color: 'var(--amber)' }}>NEEDS A RESULT</p>
          <div className="col gap-2 mt-2">
            {needsResult.map((f) => (
              <button key={f.id} className="card needs-row" onClick={() => setEditing(f)}>
                <span className="grow" style={{ textAlign: 'left' }}>
                  {f.team?.label} v {f.opponent?.name}
                </span>
                <span className="mono muted">{fmtDate(f.match_date)}</span>
                <span className="needs-cta">Log it →</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {played.length === 0 ? (
        <div className="empty mt-5">
          <p className="empty-title">No games played yet</p>
          <p>First result logged will sit here, big and proud. {isAdmin ? 'Log one above.' : 'Get a game won first.'}</p>
        </div>
      ) : (
        <>
          {/* Latest = poster hero */}
          <button
            className="result-hero mt-4"
            style={{ backgroundImage: `var(--hero-wash), ${latest.team?.key === 'community' ? 'var(--grad-community)' : 'var(--grad-xl)'}` }}
            onClick={() => setCentre(latest)}
          >
            <div className="row spread">
              <span className="kicker" style={{ color: 'rgba(255,255,255,.85)' }}>LATEST · {fmtDate(latest.match_date)}</span>
              <span className={'flash ' + outcome(latest.result)}>{OUTCOME_LABEL[outcome(latest.result)]}</span>
            </div>
            <div className="mt-3"><ScoreBug fixture={latest} size="lg" /></div>
            <p className="mono center mt-3" style={{ color: 'rgba(255,255,255,.85)', fontSize: 12 }}>
              HT {latest.result.ht_us}–{latest.result.ht_them} · tap for the match centre
            </p>
          </button>

          {/* Earlier = strips with a W/D/L flash */}
          {earlier.length > 0 && (
            <div className="col gap-2 mt-4 stagger">
              {earlier.map((f) => {
                const o = outcome(f.result)
                const community = f.team?.key === 'community'
                return (
                  <button key={f.id} className={'card spine res-strip' + (community ? ' community' : '')} onClick={() => setCentre(f)}>
                    <span className={'flash sm ' + o}>{o}</span>
                    <div className="grow" style={{ textAlign: 'left' }}>
                      <div className="res-match">{f.team?.label} v {f.opponent?.name}</div>
                      <div className="mono res-when">{fmtDate(f.match_date)} · {f.fixture_type}</div>
                    </div>
                    <span className="mono res-score">{f.result.us}–{f.result.them}</span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Postponed (P-P) games whose slot has passed — archived here, no score. */}
      {postponed.length > 0 && (
        <div className="mt-5">
          <p className="kicker" style={{ color: 'var(--bone-mute)' }}>POSTPONED</p>
          <div className="col gap-2 mt-2">
            {postponed.map((f) => (
              <div key={f.id} className={'card spine res-strip' + (f.team?.key === 'community' ? ' community' : '')}>
                <span className="flash sm D">P-P</span>
                <div className="grow">
                  <div className="res-match">{f.team?.label} v {f.opponent?.name}</div>
                  <div className="mono res-when">{fmtDate(f.match_date)} · postponed</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <MatchCentre
        open={!!centre} fixture={centre} isAdmin={isAdmin}
        onClose={() => setCentre(null)}
        onEdit={() => { const c = centre; setCentre(null); setEditing(c) }}
      />
      {/* Conditional render + key so the form remounts fresh per fixture. */}
      {isAdmin && editing && (
        <ResultForm
          key={editing.id}
          open={!!editing} fixture={editing} squad={squad}
          onClose={() => setEditing(null)} onSaved={refetch}
        />
      )}

      <style>{`
        .needs-row { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: var(--coal);
          color: var(--bone); border: 1px solid var(--line); }
        .needs-cta { color: var(--amber); font-size: 13px; font-weight: 600; }
        .result-hero { display: block; width: 100%; text-align: left; border: none; color: #fff;
          border-radius: var(--r-hero); padding: 18px; box-shadow: 0 18px 40px -20px rgba(0,0,0,.9); }
        .flash { font-family: var(--font-mono); font-size: 12px; font-weight: 600; letter-spacing: .05em;
          padding: 3px 10px; border-radius: 999px; text-transform: uppercase; }
        .flash.W { background: var(--green-dim-2); color: var(--green-bright); }
        .flash.L { background: var(--red-dim-2); color: var(--red-bright); }
        .flash.D { background: var(--slate); color: var(--bone-mute); }
        .flash.sm { width: 26px; height: 26px; display: grid; place-items: center; padding: 0; border-radius: 8px; }
        .res-strip { display: flex; align-items: center; gap: 12px; padding: 12px 14px 12px 18px;
          background: var(--coal); color: var(--bone); border: 1px solid var(--line); }
        .res-match { font-family: var(--font-display); font-weight: 600; font-size: 16px; line-height: 1.1; }
        .res-when { font-size: 12px; color: var(--bone-mute); margin-top: 3px; }
        .res-score { font-size: 20px; font-weight: 600; }
      `}</style>
    </div>
  )
}
