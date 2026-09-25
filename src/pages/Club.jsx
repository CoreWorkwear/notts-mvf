import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useSeason } from '../context/SeasonContext'
import { useClub } from '../hooks/useClub'
import { useCompetitions } from '../hooks/useCompetitions'
import LeagueTablePanel from '../components/LeagueTablePanel'
import StatsPanel from '../components/StatsPanel'
import SquadList from '../components/SquadList'
import SponsorsList from '../components/SponsorsList'
import Loader from '../components/Loader'
import PageHead from '../components/PageHead'
import TabBar from '../components/TabBar'

const CLUB_TABS = [
  { key: 'table', label: 'Table' },
  { key: 'squad', label: 'Squad' },
  { key: 'stats', label: 'Stats' },
  { key: 'sponsors', label: 'Sponsors' },
]

// Player-facing: League Table / Club Stats. Admin/config (Seasons, Media) now
// live in the Manage hub, not here.
export default function Club() {
  const { club } = useAuth()
  const { seasonId } = useSeason()
  const { table, teams, stats, loading, error, refetch } = useClub(seasonId)
  const { competitions } = useCompetitions(seasonId)
  const [view, setView] = useState('table')

  const empty = table.length === 0 && teams.length === 0

  // Only the first load gets the Loader: a refetch (e.g. after the league table
  // is edited) flips loading too, and swapping the page out unmounted the panel
  // and any sheet it had open.
  if (loading && empty) return <Loader label="Loading the club…" />

  // A failed first load (flaky connection) gets a retry, not a blank club.
  if (error && empty) return (
    <div className="page">
      <div className="empty mt-5" role="alert">
        <p className="empty-title">Couldn't load the club</p>
        <p>Looks like a dodgy connection. Have another go.</p>
        <button className="btn btn-primary mt-3" onClick={refetch}>Try again</button>
      </div>
    </div>
  )

  return (
    <div className="page">
      <PageHead kicker="THE CLUB" title={club?.name ?? 'The Club'} />
      {error && <p className="dim mt-2" role="status" style={{ fontSize: 13 }}>Couldn't refresh just now — showing what we had.</p>}
      <div className="mt-3">
        <TabBar id="club" tabs={CLUB_TABS} value={view} onChange={setView} />
      </div>

      <div className="mt-4">
        {view === 'table' ? <LeagueTablePanel table={table} competitions={competitions} teams={teams} seasonId={seasonId} onSaved={refetch} />
          : view === 'squad' ? <SquadList />
          : view === 'stats' ? <StatsPanel stats={stats} />
          : <SponsorsList />}
      </div>
    </div>
  )
}
