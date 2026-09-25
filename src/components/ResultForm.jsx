import { useEffect, useState } from 'react'
import Sheet from './Sheet'
import Toast from './Toast'
import ImageUpload from './ImageUpload'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/errors'

// Admin: log or edit a result. FT + HT scores, goals added one at a time
// (scorer + optional minute + optional assist, squad-pick-or-free-type), MOTM.
// Names resolve to profile_id when they match a squad member, else free text
// (HANDOVER §3 — stats key by profile_id). Stays mounted; resets on open.
//
// `squad` (ACTIVE players) feeds the pickers. `everyone` (optional — every club
// profile, leavers included, same {id, name} shape) is what stored ids resolve
// against, so a goal or MOTM credited to a player who has since left the club
// survives an edit. An id we can't resolve at all is carried through the save
// untouched (shown as "Former player") rather than blanked and dropped.
const FORMER = 'Former player'

export default function ResultForm({ open, onClose, onSaved, fixture, squad, everyone }) {
  const existing = fixture?.result
  const [usScore, setUsScore] = useState(0)
  const [themScore, setThemScore] = useState(0)
  const [htUs, setHtUs] = useState(0)
  const [htThem, setHtThem] = useState(0)
  const [motm, setMotm] = useState('')
  const [motmId, setMotmId] = useState(null) // the stored id, carried until the name is retyped
  const [motmPhoto, setMotmPhoto] = useState(null)
  const [goals, setGoals] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const people = everyone ?? squad

  // A stored (id, free-text) pair → what to show + the id to carry. Only a row
  // that came from an id carries one; retyping the name clears it (see setGoal).
  const resolve = (id, free) => {
    if (!id) return { text: free ?? '', id: null }
    return { text: people.find((s) => s.id === id)?.name ?? FORMER, id }
  }

  useEffect(() => {
    if (!open) return
    setError(null)
    setUsScore(existing?.us ?? 0)
    setThemScore(existing?.them ?? 0)
    setHtUs(existing?.ht_us ?? 0)
    setHtThem(existing?.ht_them ?? 0)
    const m = resolve(existing?.motm_profile_id, existing?.motm_name)
    setMotm(m.text); setMotmId(m.id)
    setMotmPhoto(existing?.motm_photo_url ?? null)
    setGoals((fixture?.goals ?? []).map((g) => {
      const s = resolve(g.scorer_profile_id, g.scorer_name)
      const a = resolve(g.assist_profile_id, g.assist_name)
      return { scorer: s.text, scorerId: s.id, minute: g.minute ?? '', assist: a.text, assistId: a.id }
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function match(name) {
    const n = (name || '').trim().toLowerCase()
    if (!n) return { id: null, name: null }
    const hit = people.find((s) => s.name.toLowerCase() === n)
    return hit ? { id: hit.id, name: null } : { id: null, name: name.trim() }
  }
  // A carried id wins; otherwise resolve what was typed.
  const pick = (text, id) => (id ? { id, name: null } : match(text))

  const addGoal = () => setGoals((g) => [...g, { scorer: '', scorerId: null, minute: '', assist: '', assistId: null }])
  const rmGoal = (i) => setGoals((g) => g.filter((_, idx) => idx !== i))
  const setGoal = (i, key, val) => setGoals((g) => g.map((row, idx) => {
    if (idx !== i) return row
    const next = { ...row, [key]: val }
    if (key === 'scorer') next.scorerId = null
    if (key === 'assist') next.assistId = null
    return next
  }))

  async function onSubmit(e) {
    e.preventDefault()
    setError(null); setBusy(true)
    try {
      const m = pick(motm, motmId)
      const { error: rErr } = await supabase.from('results').upsert({
        fixture_id: fixture.id,
        us: Number(usScore) || 0, them: Number(themScore) || 0,
        ht_us: Number(htUs) || 0, ht_them: Number(htThem) || 0,
        motm_profile_id: m.id, motm_name: m.name, motm_photo_url: motmPhoto,
      }, { onConflict: 'fixture_id' })
      if (rErr) throw rErr

      // Replace the goal set (simplest correct approach for an edit). If the
      // delete fails we MUST stop: inserting on top would double every goal.
      const { error: dErr } = await supabase.from('goals').delete().eq('fixture_id', fixture.id)
      if (dErr) throw dErr
      const rows = goals
        .filter((g) => g.scorer.trim() || g.assist.trim() || g.scorerId || g.assistId)
        .map((g) => {
          const s = pick(g.scorer, g.scorerId), a = pick(g.assist, g.assistId)
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
      setError(friendlyError(err, "Couldn't save the result — give it another go."))
    } finally {
      setBusy(false)
    }
  }

  if (!fixture) return null
  const them = fixture.opponent?.name

  // Scorers named vs goals claimed. A blank scorer row doesn't count — it's a
  // row the manager has opened but not filled, not a goal accounted for.
  const scoredFor = Number(usScore) || 0
  const named = goals.filter((g) => g.scorer.trim()).length
  const unaccounted = scoredFor - named

  return (
    <Sheet open={open} onClose={onClose}>
      <Toast message={error} onDismiss={() => setError(null)} />
      <datalist id="squad-names">
        {squad.map((s) => <option key={s.id} value={s.name} />)}
      </datalist>

      <p className="kicker"><span className="kicker-rule">{existing ? 'EDIT RESULT' : 'LOG RESULT'}</span></p>
      <h2 className="display mt-2" style={{ fontSize: 24 }}>{fixture.team?.label} v {them}</h2>

      <form className="col gap-4 mt-4" onSubmit={onSubmit}>
        {/* Each box is named above it. It used to be two unlabelled boxes with a
            trailing "XL 11s / Wollaton" caption, so the only way to know which
            score was yours was to read past both and map left-to-right. On the
            one screen where getting it backwards silently inverts a W into an L. */}
        <div>
          <p className="label">Full time</p>
          <div className="score-row mt-2">
            <div className="score-cell">
              <span className="score-team mono">{fixture.team?.label}</span>
              <input className="input score-in" type="number" min="0" value={usScore} onChange={(e) => setUsScore(e.target.value)} aria-label={`${fixture.team?.label} score`} />
            </div>
            <span className="score-sep mono">–</span>
            <div className="score-cell">
              <span className="score-team mono">{them}</span>
              <input className="input score-in" type="number" min="0" value={themScore} onChange={(e) => setThemScore(e.target.value)} aria-label={`${them} score`} />
            </div>
          </div>
        </div>

        <div>
          <p className="label">Half time <span className="dim">· optional</span></p>
          <div className="score-row mt-2">
            <div className="score-cell">
              <input className="input score-in sm" type="number" min="0" value={htUs} onChange={(e) => setHtUs(e.target.value)} aria-label={`${fixture.team?.label} half-time score`} />
            </div>
            <span className="score-sep mono">–</span>
            <div className="score-cell">
              <input className="input score-in sm" type="number" min="0" value={htThem} onChange={(e) => setHtThem(e.target.value)} aria-label={`${them} half-time score`} />
            </div>
          </div>
        </div>

        <div>
          <div className="row spread">
            <p className="label">Our goals</p>
            <button type="button" className="chip" onClick={addGoal}>Add goal</button>
          </div>

          {/* Scorers are what the stats are built from (they key by profile_id),
              and nothing previously connected them to the score just typed above.
              Log 3–1 and name one scorer and the golden boot is quietly wrong for
              the rest of the season, with nothing on screen to say so. This is a
              nudge, not a gate — a scrappy own goal or a forgotten name should
              still be savable. */}
          {unaccounted > 0 && (
            <p className="goal-check mono mt-2" role="status">
              {unaccounted} of {scoredFor} {scoredFor === 1 ? 'goal' : 'goals'} still needs a scorer
            </p>
          )}
          {unaccounted < 0 && (
            <p className="goal-check over mono mt-2" role="status">
              {goals.length} scorers named but the score says {scoredFor}
            </p>
          )}

          <div className="col gap-2 mt-2">
            {goals.length === 0 && <p className="dim" style={{ fontSize: 13 }}>No scorers yet.</p>}
            {goals.map((g, i) => (
              <div key={i} className="goal-row card">
                <div className="row gap-2">
                  <input className="input grow" list="squad-names" placeholder="Scorer" value={g.scorer} onChange={(e) => setGoal(i, 'scorer', e.target.value)} />
                  <input className="input min-in" type="number" min="0" max="120" placeholder="min" value={g.minute} onChange={(e) => setGoal(i, 'minute', e.target.value)} />
                  <button type="button" className="goal-rm" onClick={() => rmGoal(i)} aria-label={`Remove goal ${i + 1}`}>✕</button>
                </div>
                <div className="row gap-2 mt-2">
                  <input className="input grow" list="squad-names" placeholder="Assist (optional)" value={g.assist} onChange={(e) => setGoal(i, 'assist', e.target.value)} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="label">Man of the match</label>
          <input className="input" list="squad-names" placeholder="Pick or type a name" value={motm} onChange={(e) => { setMotm(e.target.value); setMotmId(null) }} />
          <div className="row gap-2 mt-2" style={{ alignItems: 'center' }}>
            <ImageUpload
              folder="motm" shape="square" maxDim={1000} current={motmPhoto}
              label={motmPhoto ? 'Change MOTM photo' : 'Add a MOTM photo'}
              hint="Landscape works best. A phone snap is fine."
              onUploaded={(url) => setMotmPhoto(url)}
            />
            {motmPhoto && (
              <button type="button" className="chip" onClick={() => setMotmPhoto(null)} style={{ color: 'var(--red-bright)' }}>Remove</button>
            )}
          </div>
        </div>

        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Saving…' : existing ? 'Save result' : 'Log result'}
        </button>
      </form>

      <style>{`
        .score-row { display: flex; align-items: flex-end; gap: 10px; }
        .score-cell { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
        /* The team name sits over its own box and is allowed to be narrow —
           truncated beats pushing the boxes off a phone screen. */
        .score-team { font-size: 11px; letter-spacing: .05em; text-transform: uppercase;
          color: var(--bone-mute); max-width: 96px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .score-in { width: 84px; text-align: center; font-family: var(--font-mono); font-size: 26px;
          padding-inline: 6px; }
        .score-in.sm { width: 64px; font-size: 18px; }
        .score-sep { color: var(--bone-dim); font-size: 20px; padding-bottom: 12px; }
        .min-in { width: 68px; text-align: center; font-family: var(--font-mono); }
        .goal-row { padding: 10px; }
        /* A quiet icon target, not a full ghost button — removing one goal row is
           not a peer of the form's actual actions. 40px keeps it tappable. */
        .goal-rm { width: 40px; height: 40px; flex: none; align-self: center;
          background: none; border: 1px solid var(--line); border-radius: var(--r-input);
          color: var(--bone-mute); font-size: 13px; line-height: 1;
          transition: color var(--t-fast), border-color var(--t-fast); }
        .goal-rm:hover { color: var(--red-bright); border-color: var(--red); }
        .goal-check { font-size: 12px; color: var(--amber); letter-spacing: .02em; }
        .goal-check.over { color: var(--bone-mute); }
      `}</style>
    </Sheet>
  )
}
