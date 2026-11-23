import LoadIssue from '../components/LoadIssue'
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
  const { seasonId, error: seasonError, refreshSeasons } = useSeason()
  const { table, teams, stats, loading, error, refetch } = useClub(seasonId)
  const { competitions, error: competitionError, refetch: reloadCompetitions, loading: loadingCompetitions } = useCompetitions(seasonId)
  const [view, setView] = useState('table')

  const empty = table.length === 0 && teams.length === 0

  // Only the first load gets the Loader: a refetch (e.g. after the league table
  // is edited) flips loading too, and swapping the page out unmounted the panel
  // and any sheet it had open.
  if (seasonError && !seasonId) return <div className="page"><LoadIssue subject="the seasons" retry={refreshSeasons} /></div>
  if (loading && empty) return <Loader route="club" title={club?.name} label="Loading the club…" />

  // A failed first load (flaky connection) gets a retry, not a blank club.
  if (error && empty) return (
    <div className="page">
      <div className="empty mt-5" role="alert">
        <p className="empty-title">Couldn't load the club</p>
        <button className="btn btn-primary mt-3" onClick={refetch}>Try again</button>
      </div>
    </div>
  )

  return (
    <div className="page">
      <PageHead kicker="THE CLUB" title={club?.name ?? 'The Club'} />
      {error && <p className="dim mt-2" role="status" style={{ fontSize: 'var(--type-sm)' }}>Couldn't refresh. Showing saved club details.</p>}
      <div className="mt-3">
        <TabBar id="club" tabs={CLUB_TABS} value={view} onChange={setView} />
      </div>

      <div className="mt-4">
        {view === 'table' && competitionError && <LoadIssue subject="the competitions" retry={reloadCompetitions} stale={!!competitions.length} />}
        {view === 'table' && !competitions.length && competitionError ? null
          : view === 'table' && !competitions.length && loadingCompetitions ? <Loader layout="table" label="Loading competitions…" />
          : view === 'table' ? <LeagueTablePanel table={table} competitions={competitions} teams={teams} seasonId={seasonId} onSaved={refetch} />
          : view === 'squad' ? <SquadList />
          : view === 'stats' ? <StatsPanel stats={stats} />
          : <SponsorsList />}
      </div>
    </div>
  )
}
