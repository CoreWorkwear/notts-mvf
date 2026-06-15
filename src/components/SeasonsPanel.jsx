import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useSeason } from '../context/SeasonContext'
import { fmtDate } from '../lib/format'
import SeasonForm from './SeasonForm'

// Admin seasons + rollover (BUILD-LIST A3).
export default function SeasonsPanel() {
  const { profile } = useAuth()
  const { seasons, seasonId, setSeasonId, refreshSeasons } = useSeason()
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(false)

  async function onSave({ id, label, start_date, end_date, makeCurrent }) {
    const row = { label: label.trim(), start_date, end_date }
    let sid = id
    if (id) {
      const { error } = await supabase.from('seasons').update(row).eq('id', id)
      if (error) throw error
    } else {
      const { data, error } = await supabase.from('seasons').insert({ club_id: profile.club_id, ...row }).select('id').single()
      if (error) throw error
      sid = data.id
    }
    if (makeCurrent && sid) await applyCurrent(sid)
    await refreshSeasons()
    if (makeCurrent && sid) setSeasonId(sid)
  }

  async function applyCurrent(id) {
    await supabase.from('seasons').update({ is_current: false }).eq('club_id', profile.club_id).neq('id', id)
    const { error } = await supabase.from('seasons').update({ is_current: true }).eq('id', id)
    if (error) throw error
  }

  async function setCurrent(id) {
    await applyCurrent(id)
    await refreshSeasons()
    setSeasonId(id)
  }

  const openAdd = () => { setEditing(null); setOpen(true) }
  const openEdit = (s) => { setEditing(s); setOpen(true) }

  return (
    <div className="mt-4">
      <button className="btn btn-primary btn-block" onClick={openAdd}>+ Start a new season</button>

      <div className="col gap-2 mt-4">
        {seasons.map((s) => (
          <div key={s.id} className={'card spn-row' + (s.is_current ? ' spn-current' : '')}>
            <button className="spn-main" onClick={() => openEdit(s)}>
              <span className="spn-label">{s.label}{s.is_current && <span className="spn-badge">CURRENT</span>}</span>
              <span className="mono spn-dates">
                {s.start_date ? `${fmtDate(s.start_date)}${s.end_date ? ' – ' + fmtDate(s.end_date) : ''}` : 'No dates set'}
              </span>
            </button>
            <div className="spn-actions" onClick={(e) => e.stopPropagation()}>
              {s.id !== seasonId && <button className="chip" onClick={() => setSeasonId(s.id)}>View</button>}
              {!s.is_current && <button className="chip" onClick={() => setCurrent(s.id)}>Set current</button>}
            </div>
          </div>
        ))}
      </div>

      <SeasonForm open={open} season={editing} onClose={() => setOpen(false)} onSave={onSave} />

      <style>{`
        .spn-row { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: var(--coal);
          color: var(--bone); border: 1px solid var(--line); }
        .spn-current { border-color: var(--line-2); }
        .spn-main { flex: 1; background: none; border: none; color: var(--bone); text-align: left; }
        .spn-label { display: block; font-family: var(--font-display); font-weight: 600; font-size: 17px; }
        .spn-badge { font-family: var(--font-mono); font-size: 9px; letter-spacing: .08em; margin-left: 8px;
          color: var(--green-bright); border: 1px solid var(--green); border-radius: 5px; padding: 1px 5px; vertical-align: middle; }
        .spn-dates { font-size: 12px; color: var(--bone-mute); margin-top: 3px; display: block; }
        .spn-actions { display: flex; gap: 6px; flex: none; }
      `}</style>
    </div>
  )
}
