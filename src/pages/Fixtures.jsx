import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useSeason } from '../context/SeasonContext'
import { useFixtures, setAvailability } from '../hooks/useFixtures'
import { useCompetitions } from '../hooks/useCompetitions'
import { usePhotoPool } from '../hooks/useMedia'
import { logError } from '../lib/logger'
import { todayISO, fmtDate, hasKickedOff } from '../lib/format'
import FixtureHero from '../components/FixtureHero'
import FixtureStrip from '../components/FixtureStrip'
import FixtureDetail from '../components/FixtureDetail'
import FixtureForm from '../components/FixtureForm'
import ResultForm from '../components/ResultForm'
import CalendarView from '../components/CalendarView'
import { Stagger, StaggerItem } from '../components/Stagger'
import PageHead from '../components/PageHead'
import Magnetic from '../components/Magnetic'
import Pressable from '../components/Pressable'
import Segmented from '../components/Segmented'
import { Reveal } from '../components/Reveal'
import Loader from '../components/Loader'
import Toast from '../components/Toast'
import { fixtureMatchup } from '../lib/teams'

// The landing + primary action surface (UX-AND-IA §1). Everyone lands here.
export default function Fixtures() {
  const { user, profile, isAdmin, teamKeys, canRespond, accountStatus, respondBlockFor } = useAuth()
  const { seasonId, error: seasonError, refreshSeasons } = useSeason()
  const { upcoming, past, teams, opponents, fixtures, loading, error, refetch, applyMyStatus } = useFixtures(seasonId)
  const { competitions } = useCompetitions(seasonId)
  const pool = usePhotoPool()
  const navigate = useNavigate()

  const [view, setView] = useState('list')
  const [teamFilter, setTeamFilter] = useState('all')
  const [detail, setDetail] = useState(null)     // fixture being viewed
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)   // fixture being edited
  const [resultFor, setResultFor] = useState(null) // fixture to log a result for
  const [everyone, setEveryone] = useState(null) // every club profile (incl. inactive), for the result form; null = not loaded
  const [toast, setToast] = useState(null)       // availability write failures

  // The result form needs the club's profiles: the ACTIVE ones for its
  // scorer/MOTM pickers, and everyone (a scorer since deactivated must still
  // resolve by id, or editing that result would drop their goal). Stats key by
  // profile_id, so a result logged with this list missing would save scorers
  // as free text — never open the form without it.
  const loadEveryone = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('profiles').select('id, first_name, last_name, active').order('last_name')
      if (error) throw error
      setEveryone((data ?? []).map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name}`, first: p.first_name, active: p.active !== false })))
      return true
    } catch (e) {
      logError('fetch', e ?? 'squad list failed', { op: 'resultSquad' })
      return false
    }
  }, [])
  useEffect(() => { if (isAdmin) loadEveryone() }, [isAdmin, loadEveryone])
  const squad = useMemo(() => (everyone ?? []).filter((p) => p.active), [everyone])

  async function openResultForm(fixture) {
    if (!everyone && !(await loadEveryone())) {
      setToast("Squad list didn't load. Check your signal and try again.")
      return
    }
    setResultFor(fixture)
  }

  // Team filter only for admins or players in both squads.
  const showFilter = isAdmin || teamKeys.length > 1

  const filtered = useMemo(
    () => (teamFilter === 'all' ? upcoming : upcoming.filter((f) => f.team?.key === teamFilter)),
    [upcoming, teamFilter]
  )
  // The hero leads with a real, on game — postponed ones show as strips below.
  const active = filtered.filter((f) => !f.postponed)
  const hero = active[0]
  const rest = active.slice(1)
  const postponedList = filtered.filter((f) => f.postponed)

  // Returns true when the write landed, false when it failed (after one retry)
  // — no throw, so a dropped connection never becomes an unhandled rejection.
  // The tap reflects instantly via applyMyStatus and rolls back on failure;
  // "TypeError: Load failed" here is the one error real players keep hitting.
  async function handleSetAvail(fixtureId, status) {
    // Last line before the write. Pending players + supporters can view but not
    // act, and since 0034 neither can anyone outside the squad that plays this
    // game, or anyone once it has kicked off. RLS refuses all three anyway —
    // this just stops us firing a doomed request and rolling the UI back.
    const target = fixtures.find((f) => f.id === fixtureId)
    if (respondBlockFor(target)) return false
    const prev = target?.myStatus ?? null
    applyMyStatus(fixtureId, status)
    let { error } = await setAvailability(fixtureId, user.id, status)
    if (error) ({ error } = await setAvailability(fixtureId, user.id, status))
    if (error) {
      logError('write', error, { op: 'setAvailability', fixtureId, status })
      applyMyStatus(fixtureId, prev)
      setToast("Couldn't save that — check your signal and give it another go.")
      return false
    }
    await refetch()
    return true
  }

  function openEdit(f) { setEditing(f); setFormOpen(true) }
  function openAdd() { setEditing(null); setFormOpen(true) }

  // Player status line / admin "needs doing" strip. "The next N" are games
  // this player can actually answer — visibility is club-wide but answering
  // is squad-scoped (0034), so a Community-only player's First Team games
  // don't count against them; nor does a postponed game.
  const answerable = active.filter((f) => { const b = respondBlockFor(f); return b === null || b === 'kicked-off' })
  const next3 = answerable.slice(0, 3)
  const inCount = next3.filter((f) => f.myStatus === 'in').length
  const needsResult = past.filter((f) => !f.hasResult).length
  const lowNumbers = upcoming.filter((f) => !f.postponed && f.match_date <= addDays(todayISO(), 7) && f.counts.in < 8).length

  if (loading && fixtures.length === 0) return <Loader label="Loading fixtures…" />

  // A first load that failed on the network: don't pretend the diary is empty,
  // and don't hang. Say what happened and let them have another go. A failed
  // seasons fetch counts too — without a season this page would show the
  // "nothing in the diary" empty state, which is a lie.
  if ((error || seasonError) && fixtures.length === 0) return (
    <div className="page">
      <div className="empty mt-5">
        <p className="empty-title">Couldn't pull the fixtures</p>
        <p>Looks like a dodgy connection. Have another go.</p>
        <button className="btn btn-primary mt-3" onClick={() => { if (seasonError) refreshSeasons(); refetch() }}>Try again</button>
      </div>
    </div>
  )

  return (
    <div className="page">
      <Toast message={toast} onDismiss={() => setToast(null)} />
      <PageHead
        kicker="NEXT UP"
        title="Fixtures"
        aside={
          <Segmented
            id="fixtures-view"
            size="sm"
            value={view}
            onChange={setView}
            options={[{ key: 'list', label: 'List' }, { key: 'calendar', label: 'Calendar' }]}
          />
        }
      />

      {showFilter && (
        <div className="mt-3">
          <Segmented
            id="fixtures-team"
            value={teamFilter}
            onChange={setTeamFilter}
            options={[
              { key: 'all', label: 'All' },
              ...teams.map((t) => ({ key: t.key, label: t.label, accent: t.key === 'community' ? 'community' : 'xl' })),
            ]}
          />
        </div>
      )}

      {/* Account-state banner — only once the profile is KNOWN. Before it loads
          canRespond is false for everyone, and this read as "awaiting sign-off". */}
      {profile && !isAdmin && !canRespond && (
        <div className="banner mt-3">
          {accountStatus === 'supporter'
            ? "Supporter account — follow the games, but you're not in the squad."
            : accountStatus === 'inactive'
            ? 'Account inactive. Have a word with the manager.'
            : 'Waiting on the manager to sign you off.'}
        </div>
      )}

      {/* Both inputs on the one control: Magnetic leans it toward a cursor,
          Pressable gives it under a thumb. Nested rather than merged because
          they animate different transforms on different elements, and only one
          of the two is ever live on a given device. */}
      {isAdmin && (
        <Magnetic className="mt-3">
          <Pressable>
            <button className="btn btn-primary btn-block" onClick={openAdd}>Add a fixture</button>
          </Pressable>
        </Magnetic>
      )}

      {view === 'calendar' ? (
        <div className="mt-4">
          <CalendarView fixtures={teamFilter === 'all' ? fixtures : fixtures.filter((f) => f.team?.key === teamFilter)} onOpen={setDetail} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty mt-5">
          <p className="empty-title">Nothing in the diary yet</p>
          <p>{isAdmin ? 'Add the first fixture.' : "First one lands here when the manager sets it."}</p>
        </div>
      ) : (
        <>
          {hero && (
            <div className="mt-4">
              <FixtureHero
                fixture={hero}
                isAdmin={isAdmin}
                blockReason={respondBlockFor(hero)}
                pool={pool}
                onSetAvail={(s) => handleSetAvail(hero.id, s)}
                onOpenWhosIn={() => (isAdmin ? navigate('/whos-in') : setDetail(hero))}
                onOpenDetail={() => setDetail(hero)}
                onEdit={() => openEdit(hero)}
              />
            </div>
          )}

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
            <Stagger className="col gap-2 mt-4">
              {rest.map((f) => (
                <StaggerItem key={f.id}>
                  <FixtureStrip
                    fixture={f}
                    isAdmin={isAdmin}
                    blockReason={respondBlockFor(f)}
                    onSetAvail={(s) => handleSetAvail(f.id, s)}
                    onOpen={() => setDetail(f)}
                  />
                </StaggerItem>
              ))}
            </Stagger>
          )}

          {postponedList.length > 0 && (
            <Reveal className="mt-5">
              <p className="kicker" style={{ color: 'var(--bone-mute)' }}>POSTPONED</p>
              <div className="col gap-2 mt-2">
                {postponedList.map((f) => (
                  <button key={f.id} className={'card spine ppd-row' + (f.team?.key === 'community' ? ' community' : '')}
                    onClick={() => setDetail(f)}>
                    <span className="flash D ppd-badge">P-P</span>
                    <span className="grow" style={{ textAlign: 'left' }}>{fixtureMatchup(f)}</span>
                    <span className="mono muted">{fmtDate(f.match_date)}</span>
                  </button>
                ))}
              </div>
            </Reveal>
          )}
        </>
      )}

      <FixtureDetail
        open={!!detail}
        fixture={detail}
        isAdmin={isAdmin}
        blockReason={respondBlockFor(detail)}
        pool={pool}
        canLogResult={!!detail && isAdmin && hasKickedOff(detail.match_date, detail.kickoff)}
        onChanged={refetch}
        onClose={() => setDetail(null)}
        onSetAvail={(s) => handleSetAvail(detail.id, s)}
        onEdit={() => { const d = detail; setDetail(null); openEdit(d) }}
        onLogResult={() => { const d = detail; setDetail(null); openResultForm(d) }}
      />

      {/* Always mounted (open toggled) so the sheet's hardware-back stays sane;
          the forms reset their fields on open, so Edit prefills correctly. */}
      {isAdmin && (
        <FixtureForm
          open={formOpen}
          onClose={() => setFormOpen(false)}
          onSaved={refetch}
          teams={teams}
          opponents={opponents}
          competitions={competitions}
          seasonId={seasonId}
          fixture={editing}
        />
      )}

      {isAdmin && (
        <ResultForm
          open={!!resultFor}
          fixture={resultFor}
          squad={squad}
          everyone={everyone ?? undefined}
          onClose={() => setResultFor(null)}
          onSaved={refetch}
        />
      )}

      <style>{`
        .status-line { color: var(--bone-mute); font-size: 14px; }
        .banner { font-size: 14px; color: var(--bone); background: var(--coal);
          border: 1px solid var(--line-2); border-left: 3px solid var(--amber);
          border-radius: 12px; padding: 12px 14px; line-height: 1.4; }
        .needs { font-size: 14px; color: var(--amber); background: var(--amber-dim);
          border: 1px solid rgba(245,166,35,.25); border-radius: 12px; padding: 10px 14px; }
        .ppd-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px 12px 18px;
          background: var(--coal); color: var(--bone); border: 1px solid var(--line); }
        .ppd-badge { font-family: var(--font-mono); font-size: 11px; font-weight: 600; letter-spacing: .05em;
          padding: 3px 8px; border-radius: 7px; background: var(--slate); color: var(--bone-mute); }
      `}</style>
    </div>
  )
}

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
