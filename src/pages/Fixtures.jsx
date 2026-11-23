import NotificationPrompt from '../components/NotificationPrompt'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useSeason } from '../context/SeasonContext'
import { useFixtures, saveFixtureAnswer } from '../hooks/useFixtures'
import { useCompetitions } from '../hooks/useCompetitions'
import { usePhotoPool } from '../hooks/useMedia'
import { logError } from '../lib/logger'
import { todayISO, fmtDate, hasKickedOff, addDaysISO, parseDate } from '../lib/format'
import FixtureHero from '../components/FixtureHero'
import Loader from '../components/Loader'
import FixtureStrip from '../components/FixtureStrip'
import FixtureDetail from '../components/FixtureDetail'
import WhosInSheet from '../components/WhosInSheet'
import FixtureForm from '../components/FixtureForm'
import ResultForm from '../components/ResultForm'
import CalendarView from '../components/CalendarView'
import PageHead from '../components/PageHead'
import Segmented from '../components/Segmented'
import SnapRail from '../components/SnapRail'
import Toast from '../components/Toast'
import { fixtureMatchup, teamLabel } from '../lib/teams'
import { leadFixture } from '../lib/players'
import '../styles/weekly-ux.css'

// The landing + primary action surface (UX-AND-IA §1). Everyone lands here.
export default function Fixtures() {
  const { user, profile, isAdmin, teamKeys, canRespond, accountStatus, respondBlockFor } = useAuth()
  const { season, seasonId, setSeasonId, loading: seasonLoading, error: seasonError, refreshSeasons } = useSeason()
  const { upcoming, past, teams, opponents, fixtures, loading, loaded, error, refetch } = useFixtures(seasonId, season?.label)
  const { competitions } = useCompetitions(seasonId)
  const pool = usePhotoPool()
  const navigate = useNavigate()
  const { pathname, search, hash } = useLocation()

  const [view, setView] = useState('list')
  const [teamFilter, setTeamFilter] = useState('all')
  const [detailId, setDetailId] = useState(null)
  const detail = fixtures.find(f => f.id === detailId)
  const [initialTab, setInitialTab] = useState('me')
  const [focusAnswer, setFocusAnswer] = useState(false)
  const [teamSheet, setTeamSheet] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)   // fixture being edited
  const [resultFor, setResultFor] = useState(null) // fixture to log a result for
  const [everyone, setEveryone] = useState(null) // every club profile (incl. inactive), for the result form; null = not loaded
  const [toast, setToast] = useState(null)       // availability write failures
  const [answered, setAnswered] = useState(false)
  const [notice, setNotice] = useState(null)

  function openDetail(fixture, tab = 'me', focus = false) {
    setInitialTab(tab)
    setFocusAnswer(focus)
    setDetailId(fixture.id)
  }

  // A reminder body opens the named game, even if the header last selected a
  // different season. A legacy tray link can open the same view, but its URL
  // never supplies an answer. New tray actions use a receipt in PushActions.
  useEffect(() => {
    const params = new URLSearchParams(search)
    const id = params.get('mvf_fixture')
    if (!id || !loaded || error || !seasonId) return
    let active = true
    const tab = params.get('view') === 'lineup' ? 'line' : 'me'
    const consume = () => {
      params.delete('mvf_fixture')
      params.delete('mvf_avail')
      params.delete('view')
      navigate({ pathname, search: params.toString(), hash }, { replace: true, preventScrollReset: true })
    }
    const fixture = fixtures.find(f => f.id === id)
    if (fixture) {
      consume()
      openDetail(fixture, tab, tab === 'me')
    } else {
      async function findSeason() {
        try {
          const { data, error } = await supabase.from('fixtures').select('season_id').eq('id', id).maybeSingle()
          if (!active) return
          if (error) throw error
          if (data?.season_id && data.season_id !== seasonId) {
            setSeasonId(data.season_id)
            return
          }
          consume()
          setToast('Fixture unavailable.')
        } catch (err) {
          if (!active) return
          logError('fetch', err, { op: 'reminderFixture' })
          consume()
          setToast("Couldn't open reminder. Check your connection and retry.")
        }
      }
      findSeason()
    }
    return () => { active = false }
  }, [search, hash, pathname, fixtures, loaded, error, seasonId, setSeasonId, navigate])

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
      setToast("Couldn't load squad. Check your connection and retry.")
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
  // For a player it is the next game they can ANSWER (leadFixture), which is not
  // always the first on the list; the rest keep their date order around it.
  const active = filtered.filter((f) => !f.postponed)
  const hero = leadFixture(active, respondBlockFor, { manager: isAdmin })
  const rest = active.filter((f) => f !== hero)
  const postponedList = filtered.filter((f) => f.postponed)

  // Returns true when the write landed, false when it failed (after one retry)
  // — no throw, so a dropped connection never becomes an unhandled rejection.
  async function handleSetAvail(fixtureId, status) {
    // Last line before the write. Pending players + supporters can view but not
    // act, and since 0034 neither can anyone outside the squad that plays this
    // game, or anyone once it has kicked off. RLS refuses all three anyway —
    // this just stops us firing a doomed request and rolling the UI back.
    const target = fixtures.find((f) => f.id === fixtureId)
    if (!target || respondBlockFor(target)) return false
    if (!navigator.onLine) {
      setToast("You're offline. Reconnect to save your answer.")
      return false
    }
    if (!(await saveFixtureAnswer(fixtureId, user.id, status))) {
      setToast("Couldn't save availability. Check your connection and retry.")
      return false
    }
    setAnswered(true)
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
  const missingResults = past.filter((f) => !f.hasResult && !f.postponed)
  const needsResult = missingResults.length
  const lowNumbers = upcoming.filter((f) => !f.postponed && f.match_date <= addDaysISO(todayISO(), 7) && f.counts.in < 8).length

  // "First load" = nothing on screen AND no load has completed yet. Not just an
  // empty list: a season with no fixtures refetches too (every return to the
  // app), and swapping to the Loader then unmounted the open Add-a-fixture
  // form, which came back blank.
  const firstLoad = !loaded && fixtures.length === 0
  if (firstLoad && navigator.onLine === false) return null // OfflineDiary above the route holds the saved match list.
  if ((loading || (!seasonId && seasonLoading)) && firstLoad) return <Loader route="fixtures" label="Loading fixtures…" />

  // A first load that failed on the network: don't pretend the diary is empty,
  // and don't hang. Say what happened and let them have another go. A failed
  // seasons fetch counts too — without a season this page would show the
  // "nothing in the diary" empty state, which is a lie.
  if ((error || seasonError) && firstLoad) return (
    <div className="page">
      <div className="empty mt-5">
        <p className="empty-title">Couldn't load fixtures</p>
        <button className="btn btn-primary mt-3" onClick={() => { if (seasonError) refreshSeasons(); refetch() }}>Try again</button>
      </div>
    </div>
  )

  return (
    <div className="page">
      <Toast message={toast} onDismiss={() => setToast(null)} />
      <Toast message={notice} tone="success" onDismiss={() => setNotice(null)} />
      {/* A refresh that failed leaves the last good page up. Say so, as the
          other pages do, rather than pass it off as fresh. */}
      {error && <p className="dim" role="status" style={{ fontSize: 'var(--type-sm)' }}>Couldn't refresh fixtures. Showing saved fixtures.</p>}
      <PageHead
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
              ...teams.map((t) => ({ key: t.key, label: teamLabel(t), accent: t.key === 'community' ? 'community' : 'xl' })),
            ]}
          />
        </div>
      )}

      {/* Account-state banner — only once the profile is KNOWN. Before it loads
          canRespond is false for everyone, and this read as "awaiting sign-off". */}
      {profile && !isAdmin && !canRespond && (
        <div className="banner mt-3">
          {accountStatus === 'supporter'
            ? 'Supporter · View only'
            : accountStatus === 'inactive'
            ? 'Account inactive'
            : 'Awaiting manager approval'}
        </div>
      )}

      {isAdmin && <button className="btn btn-primary btn-block mt-3" onClick={openAdd}>Add a fixture</button>}

      {view === 'calendar' ? (
        <div className="mt-4">
          <CalendarView fixtures={teamFilter === 'all' ? fixtures : fixtures.filter((f) => f.team?.key === teamFilter)} onOpen={openDetail} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty mt-5">
          <p className="empty-title">No fixtures</p>
        </div>
      ) : (
        <>
          {hero && (
            <div className="mt-4">
              <FixtureHero
                key={hero.id}
                fixture={hero}
                isAdmin={isAdmin}
                blockReason={respondBlockFor(hero)}
                pool={pool}
                onSetAvail={(s) => handleSetAvail(hero.id, s)}
                onOpenWhosIn={() => (isAdmin ? setTeamSheet(hero) : openDetail(hero, 'who'))}
                onOpenDetail={() => openDetail(hero)}
                onOpenLineup={isAdmin ? () => openDetail(hero, 'line') : undefined}
                onEdit={() => openEdit(hero)}
              />
            </div>
          )}

          {answered && <NotificationPrompt />}

          {/* status line / needs-doing */}
          {isAdmin ? (
            (needsResult > 0 || lowNumbers > 0) && (
              <div className="needs mt-3">
                {needsResult > 0 && <button className="needs-link" onClick={() => needsResult === 1
                  ? openResultForm(missingResults[0])
                  : navigate('/results')}>{needsResult} {needsResult === 1 ? 'game needs' : 'games need'} a result →</button>}
                {needsResult > 0 && lowNumbers > 0 && <span className="dim"> · </span>}
                {lowNumbers > 0 && <span>{lowNumbers} low on numbers</span>}
              </div>
            )
          ) : null}

          {rest.length > 0 && (
            <section className="upcoming-fixtures mt-5" aria-label="Upcoming fixtures">
              <div className="upcoming-heading">
                <h2>Upcoming</h2>
                {rest[0].match_date.slice(0, 7) === rest.at(-1).match_date.slice(0, 7) &&
                  <span>{parseDate(rest[0].match_date).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span>}
              </div>
              <SnapRail className="upcoming-list" label="Browse upcoming matches" enabled={rest.length <= 4}>
                {rest.map((f) => (
                  <FixtureStrip
                    key={f.id}
                    fixture={f}
                    isAdmin={isAdmin}
                    blockReason={respondBlockFor(f)}
                    onSetAvail={(s) => handleSetAvail(f.id, s)}
                    onOpen={() => openDetail(f)}
                    onOpenWhosIn={() => setTeamSheet(f)}
                  />
                ))}
              </SnapRail>
            </section>
          )}
          {!isAdmin && next3.length > 0 && <p className="status-line mt-3">You're in for {inCount} of the next {next3.length}</p>}

          {postponedList.length > 0 && (
            <div className="mt-5">
              <p className="kicker" style={{ color: 'var(--bone-mute)' }}>POSTPONED</p>
              <div className="col gap-2 mt-2">
                {postponedList.map((f) => (
                  <button key={f.id} className={'card spine ppd-row' + (f.team?.key === 'community' ? ' community' : '')}
                    onClick={() => openDetail(f)}>
                    <span className="flash D ppd-badge">P-P</span>
                    <span className="grow" style={{ textAlign: 'left' }}>{fixtureMatchup(f)}</span>
                    <span className="mono muted">{fmtDate(f.match_date)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <FixtureDetail
        open={!!detail}
        fixture={detail}
        initialTab={initialTab}
        focusAnswer={focusAnswer}
        isAdmin={isAdmin}
        blockReason={respondBlockFor(detail)}
        pool={pool}
        // Not for a game that already has one. The calendar opens played games
        // here, and this row carries no result or goals, so the form would open
        // blank and a save would wipe the stored score and scorers. Editing a
        // result is done from Results, where the full row is loaded. Nor for a
        // postponed one: it was not played, so there is no result to log.
        canLogResult={!!detail && isAdmin && !detail.hasResult && !detail.postponed && hasKickedOff(detail.match_date, detail.kickoff)}
        onChanged={refetch}
        onClose={() => setDetailId(null)}
        onSetAvail={(s) => handleSetAvail(detail.id, s)}
        onEdit={() => { setDetailId(null); openEdit(detail) }}
        onLogResult={() => { setDetailId(null); openResultForm(detail) }}
      />
      {isAdmin && <WhosInSheet open={!!teamSheet} fixture={teamSheet} onClose={() => setTeamSheet(null)} />}

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
          onSaved={() => { setNotice('Result saved.'); refetch() }}
          onStale={refetch}
        />
      )}

    </div>
  )
}
