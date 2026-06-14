import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useSeason } from '../context/SeasonContext'
import { useFixtures, setAvailability } from '../hooks/useFixtures'
import { todayISO } from '../lib/format'
import FixtureHero from '../components/FixtureHero'
import FixtureStrip from '../components/FixtureStrip'
import FixtureDetail from '../components/FixtureDetail'
import FixtureForm from '../components/FixtureForm'
import CalendarView from '../components/CalendarView'
import Loader from '../components/Loader'

// The landing + primary action surface (UX-AND-IA §1). Everyone lands here.
export default function Fixtures() {
  const { user, profile, isAdmin, teamKeys } = useAuth()
  const { seasonId } = useSeason()
  const { upcoming, past, teams, opponents, fixtures, loading, refetch } = useFixtures(seasonId)
  const navigate = useNavigate()

  const [view, setView] = useState('list')
  const [teamFilter, setTeamFilter] = useState('all')
  const [detail, setDetail] = useState(null)     // fixture being viewed
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)   // fixture being edited

  // Team filter only for admins or players in both squads.
  const showFilter = isAdmin || teamKeys.length > 1

  const filtered = useMemo(
    () => (teamFilter === 'all' ? upcoming : upcoming.filter((f) => f.team?.key === teamFilter)),
    [upcoming, teamFilter]
  )
  const hero = filtered[0]
  const rest = filtered.slice(1)

  async function handleSetAvail(fixtureId, status) {
    const { error } = await setAvailability(fixtureId, user.id, status)
    if (error) { alert(error.message); throw error }
    await refetch()
  }

  function openEdit(f) { setEditing(f); setFormOpen(true) }
  function openAdd() { setEditing(null); setFormOpen(true) }

  // Player status line / admin "needs doing" strip.
  const next3 = filtered.slice(0, 3)
  const inCount = next3.filter((f) => f.myStatus === 'in').length
  const needsResult = past.filter((f) => !f.hasResult).length
  const lowNumbers = upcoming.filter((f) => f.match_date <= addDays(todayISO(), 7) && f.counts.in < 8).length

  if (loading && fixtures.length === 0) return <Loader label="Pulling the fixtures…" />

  return (
    <div className="page">
      <div className="row spread" style={{ alignItems: 'flex-end' }}>
        <div>
          <p className="kicker"><span className="kicker-rule">{isAdmin ? 'THE GAFFER' : 'NEXT UP'}</span></p>
          <h1 className="display mt-2" style={{ fontSize: 28 }}>
            {isAdmin ? 'Run the day' : `Alright${profile?.first_name ? ', ' + profile.first_name : ''}`}
          </h1>
        </div>
        <div className="row gap-2">
          <button className={'chip' + (view === 'list' ? '' : '')} aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button>
          <button className="chip" aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}>Calendar</button>
        </div>
      </div>

      {showFilter && (
        <div className="row gap-2 mt-3" style={{ flexWrap: 'wrap' }}>
          <button className="chip" aria-pressed={teamFilter === 'all'} onClick={() => setTeamFilter('all')}>All</button>
          {teams.map((t) => (
            <button key={t.id} className={'chip' + (t.key === 'community' ? ' community' : '')}
              aria-pressed={teamFilter === t.key} onClick={() => setTeamFilter(t.key)}>{t.label}</button>
          ))}
        </div>
      )}

      {isAdmin && (
        <button className="btn btn-primary btn-block mt-3" onClick={openAdd}>+ Add a fixture</button>
      )}

      {view === 'calendar' ? (
        <div className="mt-4">
          <CalendarView fixtures={teamFilter === 'all' ? fixtures : fixtures.filter((f) => f.team?.key === teamFilter)} onOpen={setDetail} />
        </div>
      ) : !hero ? (
        <div className="empty mt-5">
          <p className="empty-title">Nothing in the diary yet</p>
          <p>Season's coming. {isAdmin ? 'Add the first fixture and the lads can mark themselves in.' : 'First fixture lands here when the gaffer sets it.'}</p>
        </div>
      ) : (
        <>
          <div className="mt-4">
            <FixtureHero
              fixture={hero}
              isAdmin={isAdmin}
              onSetAvail={(s) => handleSetAvail(hero.id, s)}
              onOpenWhosIn={() => (isAdmin ? navigate('/whos-in') : setDetail(hero))}
              onEdit={() => openEdit(hero)}
            />
          </div>

          {/* status line / needs-doing */}
          {isAdmin ? (
            (needsResult > 0 || lowNumbers > 0) && (
              <div className="needs mt-3">
                {needsResult > 0 && <span>{needsResult} {needsResult === 1 ? 'game needs' : 'games need'} a result</span>}
                {needsResult > 0 && lowNumbers > 0 && <span className="dim"> · </span>}
                {lowNumbers > 0 && <span>{lowNumbers} low on numbers</span>}
              </div>
            )
          ) : (
            next3.length > 0 && (
              <p className="status-line mt-3 mono">
                You're in for {inCount} of the next {next3.length}
              </p>
            )
          )}

          {rest.length > 0 && (
            <div className="col gap-2 mt-4 stagger">
              {rest.map((f) => (
                <FixtureStrip
                  key={f.id}
                  fixture={f}
                  isAdmin={isAdmin}
                  onSetAvail={(s) => handleSetAvail(f.id, s)}
                  onOpen={() => (isAdmin ? openEdit(f) : setDetail(f))}
                />
              ))}
            </div>
          )}
        </>
      )}

      <FixtureDetail
        open={!!detail}
        fixture={detail}
        isAdmin={isAdmin}
        onClose={() => setDetail(null)}
        onSetAvail={async (s) => { await handleSetAvail(detail.id, s) }}
        onEdit={() => { const d = detail; setDetail(null); openEdit(d) }}
      />

      {isAdmin && (
        <FixtureForm
          open={formOpen}
          onClose={() => setFormOpen(false)}
          onSaved={refetch}
          teams={teams}
          opponents={opponents}
          seasonId={seasonId}
          fixture={editing}
        />
      )}

      <style>{`
        .status-line { color: var(--bone-mute); font-size: 14px; }
        .needs { font-size: 14px; color: var(--amber); background: var(--amber-dim);
          border: 1px solid rgba(245,166,35,.25); border-radius: 12px; padding: 10px 14px; }
      `}</style>
    </div>
  )
}

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
