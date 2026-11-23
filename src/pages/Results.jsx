import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useSeason } from '../context/SeasonContext'
import { useResults, outcome } from '../hooks/useResults'
import { usePhotoPool } from '../hooks/useMedia'
import { fmtDate } from '../lib/format'
import { heroBackground } from '../lib/media'
import { fixtureMatchup, matchupScore, halfTimeScore } from '../lib/teams'
import ScoreBug from '../components/ScoreBug'
import MatchCentre from '../components/MatchCentre'
import ResultForm from '../components/ResultForm'
import Loader from '../components/Loader'
import PageHead from '../components/PageHead'
import Toast from '../components/Toast'
import LoadIssue from '../components/LoadIssue'
import '../styles/weekly-ux.css'

const OUTCOME_LABEL = { W: 'Won', D: 'Drawn', L: 'Lost' }

export default function Results() {
  const { isAdmin } = useAuth()
  const { seasonId, loading: seasonLoading, error: seasonError, refreshSeasons } = useSeason()
  const { played, needsResult, postponed, squad, everyone, loading, error, refetch, applySavedResult } = useResults(seasonId)
  const pool = usePhotoPool()
  const [centre, setCentre] = useState(null)   // fixture for match centre
  const [editing, setEditing] = useState(null) // fixture for result form
  const [justSaved, setJustSaved] = useState(false)

  if (!seasonId && seasonError) return <div className="page"><LoadIssue subject="the seasons" retry={refreshSeasons} /></div>
  if (!seasonId && seasonLoading) return <Loader label="Loading results…" />
  if (loading && played.length === 0 && needsResult.length === 0 && postponed.length === 0) return <Loader label="Loading results…" />

  // A failed first load (flaky connection) gets a retry, not "no games played".
  if (error && played.length === 0 && needsResult.length === 0 && postponed.length === 0) return (
    <div className="page">
      <div className="empty mt-5">
        <p className="empty-title">Couldn't load results</p>
        <button className="btn btn-primary mt-3" onClick={refetch}>Try again</button>
      </div>
    </div>
  )

  const [latest, ...earlier] = played

  return (
    <div className="page">
      <PageHead title="Results" />
      {error && <LoadIssue subject="results" retry={refetch} stale />}
      <Toast message={justSaved ? 'Result saved.' : null} tone="success" onDismiss={() => setJustSaved(false)} />

      {/* Admin: games still needing a result */}
      {isAdmin && needsResult.length > 0 && (
        <div className="mt-4">
          <p className="kicker" style={{ color: 'var(--amber)' }}>NEEDS A RESULT</p>
          <div className="col gap-2 mt-2">
            {needsResult.map((f) => (
              <button key={f.id} className="card needs-row" onClick={() => setEditing(f)}>
                <span className="grow" style={{ textAlign: 'left' }}>
                  {fixtureMatchup(f)}
                </span>
                <span className="mono muted">{fmtDate(f.match_date)}</span>
                <span className="needs-cta">Log result →</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {played.length === 0 ? (
        <div className="empty mt-5">
          <p className="empty-title">No games played yet</p>
        </div>
      ) : (
        <>
          {/* Latest = poster hero */}
          <button
            className="result-hero mt-4"
            style={{ backgroundImage: heroBackground({ pinnedUrl: latest.pinnedUrl, pool, seed: latest.id, gradient: latest.team?.key === 'community' ? 'var(--grad-community)' : 'var(--grad-xl)' }), backgroundSize: 'cover', backgroundPosition: 'center' }}
            onClick={() => setCentre(latest)}
          >
            <div className="row spread">
              <span className="kicker poster-plate">Latest · <span className="mono">{fmtDate(latest.match_date)}</span></span>
              <span className={'flash ' + outcome(latest.result)}>{OUTCOME_LABEL[outcome(latest.result)]}</span>
            </div>
            <div className="mt-3"><ScoreBug fixture={latest} size="lg" /></div>
            <p className="result-open mt-3" style={{ color: 'var(--on-photo-muted)', fontSize: 'var(--type-caption)' }}>
              {halfTimeScore(latest.result) && <span className="mono">HT {halfTimeScore(latest.result)}</span>}<strong>Match centre <span aria-hidden="true">→</span></strong>
            </p>
          </button>

          {/* Earlier = strips with a W/D/L flash */}
          {earlier.length > 0 && (
            <div className="col gap-2 mt-4">
              {earlier.map((f) => {
                const o = outcome(f.result)
                const community = f.team?.key === 'community'
                return (
                  <button key={f.id} className={'card spine res-strip' + (community ? ' community' : '')} style={{ width: '100%' }} onClick={() => setCentre(f)}>
                    <span className={'flash sm ' + o}>{o}</span>
                    <div className="grow" style={{ textAlign: 'left' }}>
                      <div className="res-match">{fixtureMatchup(f)}</div>
                      <div className="res-when"><span className="mono">{fmtDate(f.match_date)}</span> · {f.fixture_type}</div>
                    </div>
                    <span className="mono res-score">{matchupScore(f)}</span>
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
                  <div className="res-match">{fixtureMatchup(f)}</div>
                  <div className="res-when"><span className="mono">{fmtDate(f.match_date)}</span> · postponed</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <MatchCentre
        open={!!centre} fixture={centre} isAdmin={isAdmin} pool={pool}
        onClose={() => setCentre(null)}
        onEdit={() => { const c = centre; setCentre(null); setEditing(c) }}
      />
      {/* Always mounted; resets on open so prefill is correct per fixture. */}
      {isAdmin && (
        <ResultForm
          open={!!editing} fixture={editing} squad={squad} everyone={everyone}
          onClose={() => setEditing(null)}
          onSaved={submitted => { applySavedResult(submitted); setJustSaved(true); refetch() }}
          onStale={refetch}
        />
      )}

      <style>{`
        .needs-row { display: grid; grid-template-columns: minmax(0, 1fr) auto;
          gap: var(--space-1) var(--space-2); align-items: center; padding: var(--space-3);
          text-align: start; background: var(--coal); color: var(--bone); border: 1px solid var(--line); }
        .needs-row .grow { grid-column: 1 / -1; font-size: var(--type-body); font-weight: 600; }
        .needs-row .mono { font-size: var(--type-sm); }
        .needs-cta { color: var(--amber); font-size: var(--type-sm); font-weight: 600; }
        .result-hero { display: block; width: 100%; text-align: left; border: none; color: var(--on-photo);
          border-radius: var(--r-card); padding: var(--space-4); border: 1px solid var(--border-strong); }
        .flash { font-size: var(--type-caption); font-weight: 600; letter-spacing: .05em;
          padding: var(--space-1) var(--space-2); border-radius: var(--r-pill); text-transform: uppercase; }
        .flash.W { background: var(--green-dim-2); color: var(--green-bright); }
        .flash.L { background: var(--red-dim-2); color: var(--red-bright); }
        .flash.D { background: var(--slate); color: var(--bone-mute); }
        .result-hero .flash { background: var(--poster-control); }
        .result-hero .flash.W { color: var(--poster-green); }
        .result-hero .flash.L { color: var(--poster-red); }
        .result-hero .flash.D { color: var(--on-photo-muted); }
        .flash.sm { width: 26px; height: 26px; display: grid; place-items: center; padding: 0; border-radius: 8px; }
        .res-strip { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
          background: var(--coal); color: var(--bone); border: 1px solid var(--line); }
        .res-match { font-family: var(--font-display); font-weight: 600; font-size: var(--type-body); line-height: 1.1; }
        .res-when { font-size: var(--type-caption); color: var(--bone-mute); margin-top: var(--space-1); }
        .res-score { font-size: var(--type-lg); font-weight: 600; }
      `}</style>
    </div>
  )
}
