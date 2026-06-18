import { useState } from 'react'
import { useSeason } from '../context/SeasonContext'
import { useClub } from '../hooks/useClub'
import { useCompetitions } from '../hooks/useCompetitions'
import LeagueTablePanel from '../components/LeagueTablePanel'
import StatsPanel from '../components/StatsPanel'
import SponsorsList from '../components/SponsorsList'
import Loader from '../components/Loader'

// Player-facing: League Table / Club Stats. Admin/config (Seasons, Media) now
// live in the Manage hub, not here.
export default function Club() {
  const { seasonId } = useSeason()
  const { table, teams, stats, loading, refetch } = useClub(seasonId)
  const { competitions } = useCompetitions(seasonId)
  const [view, setView] = useState('table')

  if (loading) return <Loader label="Totting up the club…" />

  return (
    <div className="page">
      <p className="kicker"><span className="kicker-rule">THE CLUB</span></p>
      <div className="row gap-2 mt-3">
        <button className={'btn grow club-tab ' + (view === 'table' ? 'btn-primary' : 'btn-ghost')} onClick={() => setView('table')}>Table</button>
        <button className={'btn grow club-tab ' + (view === 'stats' ? 'btn-primary' : 'btn-ghost')} onClick={() => setView('stats')}>Stats</button>
        <button className={'btn grow club-tab ' + (view === 'sponsors' ? 'btn-primary' : 'btn-ghost')} onClick={() => setView('sponsors')}>Sponsors</button>
      </div>

      {view === 'table' ? <LeagueTablePanel table={table} competitions={competitions} teams={teams} seasonId={seasonId} onSaved={refetch} />
        : view === 'stats' ? <StatsPanel stats={stats} />
        : <SponsorsList />}

      <style>{`.club-tab { padding-left: 8px; padding-right: 8px; }`}</style>
    </div>
  )
}
