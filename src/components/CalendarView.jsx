import { useState } from 'react'
import { MONTHS_FULL, parseDate, fmtKO, todayISO } from '../lib/format'
import { fixtureMatchup } from '../lib/teams'

// Month grid with team-coloured tappable dots + a "this month" agenda list.
export default function CalendarView({ fixtures, onOpen }) {
  const first = fixtures[0]
  const start = first ? parseDate(first.match_date) : parseDate(todayISO())
  const [cursor, setCursor] = useState({ y: start.getFullYear(), m: start.getMonth() })

  const monthFixtures = fixtures.filter((f) => {
    const d = parseDate(f.match_date)
    return d.getFullYear() === cursor.y && d.getMonth() === cursor.m
  })
  const byDay = {}
  for (const f of monthFixtures) byDay[parseDate(f.match_date).getDate()] = f

  const firstWeekday = new Date(cursor.y, cursor.m, 1).getDay()
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate()
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  const today = todayISO()

  const step = (dir) => setCursor(({ y, m }) => {
    const nm = m + dir
    if (nm < 0) return { y: y - 1, m: 11 }
    if (nm > 11) return { y: y + 1, m: 0 }
    return { y, m: nm }
  })

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
          const f = byDay[day]
          const iso = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          return (
            <button key={i} className={'cal-cell' + (iso === today ? ' today' : '') + (f ? ' has' : '')}
              onClick={() => f && onOpen(f)} disabled={!f}>
              <span className="mono">{day}</span>
              {f && <span className={'cal-dot' + (f.team?.key === 'community' ? ' community' : '')} />}
            </button>
          )
        })}
      </div>

      <div className="col gap-2 mt-4">
        {monthFixtures.length === 0 && <p className="muted center">Nothing on this month.</p>}
        {monthFixtures.map((f) => (
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
        .cal-cell:disabled { opacity: .6; }
        .cal-dot { width: 6px; height: 6px; border-radius: 99px; background: var(--red); }
        .cal-dot.community { background: var(--green); }
        .cal-agenda { display: flex; align-items: center; gap: 12px; padding: 12px 14px 12px 18px; border: 1px solid var(--line);
          background: var(--coal); color: var(--bone); }
        .cal-ag-date { font-size: 18px; font-weight: 600; min-width: 24px; }
      `}</style>
    </div>
  )
}
