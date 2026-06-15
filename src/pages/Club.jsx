import { useState } from 'react'
import { useSeason } from '../context/SeasonContext'
import { useClub } from '../hooks/useClub'
import LeagueTablePanel from '../components/LeagueTablePanel'
import StatsPanel from '../components/StatsPanel'
import Loader from '../components/Loader'

// Player-facing: League Table / Club Stats. Admin/config (Seasons, Media) now
// live in the Manage hub, not here.
export default function Club() {
  const { seasonId } = useSeason()
  const { table, teams, stats, loading, refetch } = useClub(seasonId)
  const [view, setView] = useState('table')

  if (loading) return <Loader label="Totting up the club…" />

  return (
    <div className="page">
      <p className="kicker"><span className="kicker-rule">THE CLUB</span></p>
      <div className="row gap-2 mt-3">
        <button className={'btn grow ' + (view === 'table' ? 'btn-primary' : 'btn-ghost')} onClick={() => setView('table')}>League Table</button>
        <button className={'btn grow ' + (view === 'stats' ? 'btn-primary' : 'btn-ghost')} onClick={() => setView('stats')}>Club Stats</button>
      </div>

      {view === 'table' ? <LeagueTablePanel table={table} teams={teams} seasonId={seasonId} onSaved={refetch} /> : <StatsPanel stats={stats} />}
    </div>
  )
}
