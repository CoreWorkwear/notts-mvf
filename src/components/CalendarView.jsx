import { useState } from 'react'
import { MONTHS_FULL, parseDate, fmtKO, fmtDateLong, todayISO } from '../lib/format'
import { fixtureMatchup } from '../lib/teams'

// Month grid with a team-coloured tappable dot PER GAME + a "this month" agenda
// list. First Team + Community on the same Sunday is this club's normal weekend,
// so a day holds a list: one game opens on tap; two or more narrow the agenda
// below to that day so either can be picked.
export default function CalendarView({ fixtures, onOpen }) {
  const today = todayISO()
  // Open on the month of the next game (or this month if nothing's coming up)
  // — not whatever happens to be first in the list.
  const next = fixtures.filter((f) => f.match_date >= today).map((f) => f.match_date).sort()[0]
  const start = parseDate(next ?? today)
  const [cursor, setCursor] = useState({ y: start.getFullYear(), m: start.getMonth() })
  const [pickedDay, setPickedDay] = useState(null) // ISO date narrowing the agenda

  const monthFixtures = fixtures.filter((f) => {
    const d = parseDate(f.match_date)
    return d.getFullYear() === cursor.y && d.getMonth() === cursor.m
  })
  const byDay = {}
  for (const f of monthFixtures) {
    const d = parseDate(f.match_date).getDate()
    if (!byDay[d]) byDay[d] = []
    byDay[d].push(f)
  }

  const firstWeekday = new Date(cursor.y, cursor.m, 1).getDay()
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate()
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]

  const step = (dir) => {
    setPickedDay(null)
    setCursor(({ y, m }) => {
      const nm = m + dir
      if (nm < 0) return { y: y - 1, m: 11 }
      if (nm > 11) return { y: y + 1, m: 0 }
      return { y, m: nm }
    })
  }

  const tapDay = (iso, games) => {
    if (games.length === 1) onOpen(games[0])
    else setPickedDay(iso)
  }

  const agenda = pickedDay ? monthFixtures.filter((f) => f.match_date === pickedDay) : monthFixtures

  return (
    <div className="cal">
      <div className="cal-head">
        <button className="btn btn-ghost" onClick={() => step(-1)} aria-label="Previous month">‹</button>
        <span className="display" style={{ fontSize: 'var(--type-lg)' }}>{MONTHS_FULL[cursor.m]} {cursor.y}</span>
        <button className="btn btn-ghost" onClick={() => step(1)} aria-label="Next month">›</button>
      </div>

      <p className="cal-pan muted">Scroll for more days</p>
      <div className="cal-grid" role="region" tabIndex={0} aria-label={`${MONTHS_FULL[cursor.m]} ${cursor.y} calendar`}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <span key={day} className="cal-dow">{day}</span>)}
        {cells.map((day, i) => {
          if (!day) return <span key={i} />
          const games = byDay[day] ?? []
          const iso = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          return (
            <button key={i}
              className={'cal-cell' + (iso === today ? ' today' : '') + (games.length ? ' has' : '') + (iso === pickedDay ? ' picked' : '')}
              aria-current={iso === today ? 'date' : undefined}
              aria-pressed={games.length > 1 ? iso === pickedDay : undefined}
              onClick={() => tapDay(iso, games)} disabled={!games.length}>
              <span className="mono">{day}</span>
              {games.length > 0 && (
                <span className="cal-dots">
                  {games.map((f) => <span key={f.id} className={'cal-dot' + (f.team?.key === 'community' ? ' community' : '') + (f.postponed ? ' off' : '')} />)}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="col gap-2 mt-4">
        {pickedDay && (
          <div className="row spread" style={{ alignItems: 'center' }}>
            <p className="kicker">{fmtDateLong(pickedDay).toUpperCase()} · {agenda.length} GAMES</p>
            <button className="chip" onClick={() => setPickedDay(null)}>Whole month</button>
          </div>
        )}
        {agenda.length === 0 && <p className="muted center">{pickedDay ? 'No fixtures on this date' : 'No fixtures this month'}</p>}
        {agenda.map((f) => (
          <button key={f.id} className={'card spine cal-agenda' + (f.team?.key === 'community' ? ' community' : '')} onClick={() => onOpen(f)}>
            <span className="mono cal-ag-date">{parseDate(f.match_date).getDate()}</span>
            <span className="grow" style={{ textAlign: 'left' }}>{fixtureMatchup(f)}</span>
            {/* A game that is off must not read as one that is on. */}
            {f.postponed
              ? <span className="mono cal-ppd">P-P</span>
              : <span className="mono muted">{fmtKO(f.kickoff)}</span>}
          </button>
        ))}
      </div>

      <style>{`
        .cal { container-type: inline-size; }
        .cal-head { display: grid; grid-template-columns: var(--target) minmax(0,1fr) var(--target); align-items: center; }
        .cal-head .display { text-align: center; overflow-wrap: anywhere; }
        .cal-head .btn { padding: var(--space-1) var(--space-3); }
        .cal-grid { display: grid; grid-template-columns: repeat(7, minmax(var(--target), 1fr));
          gap: var(--space-1); margin-top: var(--space-3); overflow-x: auto; overscroll-behavior-x: contain; }
        .cal-pan { display: none; }
        /* Seven 48px targets and six 4px gaps need 360px of content width.
           Keep the weekday headings on the same scroller as their dates. */
        @container (width < 360px) {
          .cal-pan { display: block; font-size: var(--type-caption); margin-top: var(--space-2); }
        }
        @container (width < 15em) {
          .cal-head { row-gap: var(--space-1); }
          .cal-head .display { grid-column: 1 / -1; grid-row: 1; }
          .cal-head button:last-child { grid-column: 3; }
        }
        .cal-dow { text-align: center; font-size: var(--type-xs); color: var(--bone-dim); padding: var(--space-1) 0; }
        .cal-cell { aspect-ratio: 1; min-block-size: var(--target); border: 1px solid transparent; background: var(--coal); border-radius: var(--r-card);
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-1);
          color: var(--bone-mute); font-size: var(--type-sm); }
        .cal-cell.today { border-color: var(--line-2); color: var(--bone); }
        .cal-cell.has { border-color: var(--border-strong); border-bottom-width: 3px; background: var(--surface); color: var(--bone); }
        .cal-cell.picked { border-color: var(--bone-mute); }
        .cal-cell:disabled { color: var(--text-muted); opacity: 1; }
        .cal-dots { display: flex; gap: var(--space-1); }
        .cal-dot { width: 6px; height: 6px; border-radius: 99px; background: var(--red); }
        .cal-dot.community { background: var(--green); }
        .cal-dot.off, .cal-dot.community.off { background: transparent; border: 1px solid var(--bone-mute); }
        .cal-ppd { font-size: var(--type-xs); font-weight: 600; letter-spacing: .05em; padding: var(--space-1) var(--space-2); border-radius: var(--r-input);
          background: var(--slate); color: var(--bone-mute); }
        .cal-agenda { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4); border: 1px solid var(--line);
          background: var(--coal); color: var(--bone); }
        .cal-ag-date { font-size: var(--type-lead); font-weight: 600; min-width: 24px; }
        .cal-agenda .grow { min-inline-size: 0; overflow-wrap: anywhere; }
      `}</style>
    </div>
  )
}
