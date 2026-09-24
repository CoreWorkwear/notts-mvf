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
        <span className="display" style={{ fontSize: 20 }}>{MONTHS_FULL[cursor.m]} {cursor.y}</span>
        <button className="btn btn-ghost" onClick={() => step(1)} aria-label="Next month">›</button>
      </div>

      <div className="cal-grid">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i} className="cal-dow mono">{d}</span>)}
        {cells.map((day, i) => {
          if (!day) return <span key={i} />
          const games = byDay[day] ?? []
          const iso = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          return (
            <button key={i}
              className={'cal-cell' + (iso === today ? ' today' : '') + (games.length ? ' has' : '') + (iso === pickedDay ? ' picked' : '')}
              onClick={() => tapDay(iso, games)} disabled={!games.length}>
              <span className="mono">{day}</span>
              {games.length > 0 && (
                <span className="cal-dots">
                  {games.map((f) => <span key={f.id} className={'cal-dot' + (f.team?.key === 'community' ? ' community' : '')} />)}
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
        {agenda.length === 0 && <p className="muted center">Nothing on this month.</p>}
        {agenda.map((f) => (
          <button key={f.id} className={'card spine cal-agenda' + (f.team?.key === 'community' ? ' community' : '')} onClick={() => onOpen(f)}>
            <span className="mono cal-ag-date">{parseDate(f.match_date).getDate()}</span>
            <span className="grow" style={{ textAlign: 'left' }}>{fixtureMatchup(f)}</span>
            <span className="mono muted">{fmtKO(f.kickoff)}</span>
          </button>
        ))}
      </div>

      <style>{`
        .cal-head { display: flex; align-items: center; justify-content: space-between; }
        .cal-head .btn { padding: 6px 14px; }
        .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-top: 14px; }
        .cal-dow { text-align: center; font-size: 11px; color: var(--bone-dim); padding: 4px 0; }
        .cal-cell { aspect-ratio: 1; border: 1px solid transparent; background: var(--coal); border-radius: 10px;
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
          color: var(--bone-mute); font-size: 13px; }
        .cal-cell.today { border-color: var(--line-2); color: var(--bone); }
        .cal-cell.has { background: var(--slate); color: var(--bone); }
        .cal-cell.picked { border-color: var(--bone-mute); }
        .cal-cell:disabled { opacity: .6; }
        .cal-dots { display: flex; gap: 3px; }
        .cal-dot { width: 6px; height: 6px; border-radius: 99px; background: var(--red); }
        .cal-dot.community { background: var(--green); }
        .cal-agenda { display: flex; align-items: center; gap: 12px; padding: 12px 14px 12px 18px; border: 1px solid var(--line);
          background: var(--coal); color: var(--bone); }
        .cal-ag-date { font-size: 18px; font-weight: 600; min-width: 24px; }
      `}</style>
    </div>
  )
}
