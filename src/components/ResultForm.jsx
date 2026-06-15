import { useEffect, useState } from 'react'
import Sheet from './Sheet'
import Toast from './Toast'
import { supabase } from '../lib/supabase'

// Admin: log or edit a result. FT + HT scores, goals added one at a time
// (scorer + optional minute + optional assist, squad-pick-or-free-type), MOTM.
// Names resolve to profile_id when they match a squad member, else free text
// (HANDOVER §3 — stats key by profile_id). Stays mounted; resets on open.
export default function ResultForm({ open, onClose, onSaved, fixture, squad }) {
  const existing = fixture?.result
  const [usScore, setUsScore] = useState(0)
  const [themScore, setThemScore] = useState(0)
  const [htUs, setHtUs] = useState(0)
  const [htThem, setHtThem] = useState(0)
  const [motm, setMotm] = useState('')
  const [goals, setGoals] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const nameFor = (id, free) => (id ? squad.find((s) => s.id === id)?.name ?? '' : free ?? '')

  useEffect(() => {
    if (!open) return
    setError(null)
    setUsScore(existing?.us ?? 0)
    setThemScore(existing?.them ?? 0)
    setHtUs(existing?.ht_us ?? 0)
    setHtThem(existing?.ht_them ?? 0)
    setMotm(nameFor(existing?.motm_profile_id, existing?.motm_name))
    setGoals((fixture?.goals ?? []).map((g) => ({
      scorer: nameFor(g.scorer_profile_id, g.scorer_name),
      minute: g.minute ?? '',
      assist: nameFor(g.assist_profile_id, g.assist_name),
    })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function match(name) {
    const n = (name || '').trim().toLowerCase()
    if (!n) return { id: null, name: null }
    const hit = squad.find((s) => s.name.toLowerCase() === n)
    return hit ? { id: hit.id, name: null } : { id: null, name: name.trim() }
  }

  const addGoal = () => setGoals((g) => [...g, { scorer: '', minute: '', assist: '' }])
  const rmGoal = (i) => setGoals((g) => g.filter((_, idx) => idx !== i))
  const setGoal = (i, key, val) => setGoals((g) => g.map((row, idx) => (idx === i ? { ...row, [key]: val } : row)))

  async function onSubmit(e) {
    e.preventDefault()
    setError(null); setBusy(true)
    try {
      const m = match(motm)
      const { error: rErr } = await supabase.from('results').upsert({
        fixture_id: fixture.id,
        us: Number(usScore) || 0, them: Number(themScore) || 0,
        ht_us: Number(htUs) || 0, ht_them: Number(htThem) || 0,
        motm_profile_id: m.id, motm_name: m.name,
      }, { onConflict: 'fixture_id' })
      if (rErr) throw rErr

      // Replace the goal set (simplest correct approach for an edit).
      await supabase.from('goals').delete().eq('fixture_id', fixture.id)
      const rows = goals
        .filter((g) => g.scorer.trim() || g.assist.trim())
        .map((g) => {
          const s = match(g.scorer), a = match(g.assist)
          return {
            fixture_id: fixture.id,
            scorer_profile_id: s.id, scorer_name: s.name,
            assist_profile_id: a.id, assist_name: a.name,
            minute: g.minute === '' ? null : Number(g.minute),
          }
        })
      if (rows.length) {
        const { error: gErr } = await supabase.from('goals').insert(rows)
        if (gErr) throw gErr
      }

      onSaved(); onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!fixture) return null
  const them = fixture.opponent?.name

  return (
    <Sheet open={open} onClose={onClose}>
      <Toast message={error} onDismiss={() => setError(null)} />
      <datalist id="squad-names">
        {squad.map((s) => <option key={s.id} value={s.name} />)}
      </datalist>

      <p className="kicker"><span className="kicker-rule">{existing ? 'EDIT RESULT' : 'LOG RESULT'}</span></p>
      <h2 className="display mt-2" style={{ fontSize: 24 }}>{fixture.team?.label} v {them}</h2>

      <form className="col gap-4 mt-4" onSubmit={onSubmit}>
        <div>
          <p className="label">Full time</p>
          <div className="row gap-2 mt-1" style={{ alignItems: 'center' }}>
            <input className="input score-in" type="number" min="0" value={usScore} onChange={(e) => setUsScore(e.target.value)} aria-label="Our score" />
            <span className="mono dim">–</span>
            <input className="input score-in" type="number" min="0" value={themScore} onChange={(e) => setThemScore(e.target.value)} aria-label="Their score" />
            <span className="muted" style={{ fontSize: 13 }}>{fixture.team?.label} / {them}</span>
          </div>
        </div>

        <div>
          <p className="label">Half time</p>
          <div className="row gap-2 mt-1" style={{ alignItems: 'center' }}>
            <input className="input score-in" type="number" min="0" value={htUs} onChange={(e) => setHtUs(e.target.value)} aria-label="Our HT score" />
            <span className="mono dim">–</span>
            <input className="input score-in" type="number" min="0" value={htThem} onChange={(e) => setHtThem(e.target.value)} aria-label="Their HT score" />
          </div>
        </div>

        <div>
          <div className="row spread">
            <p className="label">Our goals</p>
            <button type="button" className="chip" onClick={addGoal}>+ Add goal</button>
          </div>
          <div className="col gap-2 mt-2">
            {goals.length === 0 && <p className="dim" style={{ fontSize: 13 }}>No goals added.</p>}
            {goals.map((g, i) => (
              <div key={i} className="goal-row card" style={{ padding: 10 }}>
                <div className="row gap-2">
                  <input className="input grow" list="squad-names" placeholder="Scorer" value={g.scorer} onChange={(e) => setGoal(i, 'scorer', e.target.value)} />
                  <input className="input min-in" type="number" min="0" max="120" placeholder="min" value={g.minute} onChange={(e) => setGoal(i, 'minute', e.target.value)} />
                </div>
                <div className="row gap-2 mt-2">
                  <input className="input grow" list="squad-names" placeholder="Assist (optional)" value={g.assist} onChange={(e) => setGoal(i, 'assist', e.target.value)} />
                  <button type="button" className="btn btn-ghost" onClick={() => rmGoal(i)} aria-label="Remove goal">✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="label">Man of the match</label>
          <input className="input" list="squad-names" placeholder="Pick or type a name" value={motm} onChange={(e) => setMotm(e.target.value)} />
        </div>

        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Saving…' : existing ? 'Save result' : 'Log result'}
        </button>
      </form>

      <style>{`
        .score-in { width: 72px; text-align: center; font-family: var(--font-mono); font-size: 22px; }
        .min-in { width: 70px; text-align: center; font-family: var(--font-mono); }
      `}</style>
    </Sheet>
  )
}
