import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useSeason } from '../context/SeasonContext'
import { useClub } from '../hooks/useClub'
import LeagueTablePanel from '../components/LeagueTablePanel'
import StatsPanel from '../components/StatsPanel'
import MediaPanel from '../components/MediaPanel'
import SeasonsPanel from '../components/SeasonsPanel'
import Loader from '../components/Loader'

// Sub-toggle between League Table, Club Stats and (admin) Media (HANDOVER §5/§6).
export default function Club() {
  const { isAdmin } = useAuth()
  const { seasonId } = useSeason()
  const { table, teams, stats, loading, refetch } = useClub(seasonId)
  const [view, setView] = useState('table')

  if (loading) return <Loader label="Totting up the club…" />

  return (
    <div className="page">
      <p className="kicker"><span className="kicker-rule">THE CLUB</span></p>
      <div className="row gap-2 mt-3" style={{ flexWrap: 'wrap' }}>
        <button className={'btn grow ' + (view === 'table' ? 'btn-primary' : 'btn-ghost')} onClick={() => setView('table')}>League Table</button>
        <button className={'btn grow ' + (view === 'stats' ? 'btn-primary' : 'btn-ghost')} onClick={() => setView('stats')}>Club Stats</button>
        {isAdmin && (
          <button className={'btn grow ' + (view === 'media' ? 'btn-primary' : 'btn-ghost')} onClick={() => setView('media')}>Media</button>
        )}
        {isAdmin && (
          <button className={'btn grow ' + (view === 'seasons' ? 'btn-primary' : 'btn-ghost')} onClick={() => setView('seasons')}>Seasons</button>
        )}
      </div>

      {view === 'table' && <LeagueTablePanel table={table} teams={teams} seasonId={seasonId} onSaved={refetch} />}
      {view === 'stats' && <StatsPanel stats={stats} />}
      {view === 'media' && isAdmin && <MediaPanel />}
      {view === 'seasons' && isAdmin && <SeasonsPanel />}
    </div>
  )
}
