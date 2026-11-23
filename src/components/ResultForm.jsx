import { useEffect, useId, useRef, useState } from 'react'
import Sheet from './Sheet'
import Toast from './Toast'
import ScoreBug from './ScoreBug'
import ImageUpload from './ImageUpload'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/errors'
import { teamLabel, teamMatchName } from '../lib/teams'
import { haptic } from '../lib/haptics'

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

// The stored columns a new result is compared against when the database says
// one already exists (see onSubmit).
const RESULT_FIELDS = ['us', 'them', 'ht_us', 'ht_them', 'motm_profile_id', 'motm_name', 'motm_photo_url']

// `onStale` (optional) tells the page its list is out of date — a result exists
// that the row this form was opened from did not know about — so it can refetch.
export default function ResultForm({ open, onClose, onSaved, onStale, fixture, squad, everyone }) {
  const formId = useId()
  const heading = useRef(null)
  const existing = fixture?.result
  const [usScore, setUsScore] = useState(0)
  const [themScore, setThemScore] = useState(0)
  // Half time is optional: blank means "not recorded", which is not 0–0.
  const [htUs, setHtUs] = useState('')
  const [htThem, setHtThem] = useState('')
  const [motm, setMotm] = useState('')
  const [motmId, setMotmId] = useState(null) // the stored id, carried until the name is retyped
  const [motmPhoto, setMotmPhoto] = useState(null)
  const [goals, setGoals] = useState([])
  const [picker, setPicker] = useState(null)
  const [pending, setPending] = useState({})
  const visibleFixture = useRef(null)
  visibleFixture.current = open ? fixture?.id : null
  const [error, setError] = useState(null)
  // True once THIS form has put a results row in: a retry after a later step
  // failed must be allowed to finish, not be refused as somebody else's result.
  const wroteResult = useRef(false)

  const people = everyone ?? squad

  // A stored (id, free-text) pair → what to show + the id to carry. Only a row
  // that came from an id carries one; retyping the name clears it (see setGoal).
  const resolve = (id, free) => {
    if (!id) return { text: free ?? '', id: null }
    return { text: people.find((s) => s.id === id)?.name ?? FORMER, id }
  }

  useEffect(() => {
    if (!open || !fixture) return
    // Closing a sheet does not cancel its write. Reopening the same game
    // restores the submitted draft; a different game's editor stays independent.
    const source = pending[fixture.id] ?? fixture
    const initial = source.result
    setError(null)
    setPicker(null)
    wroteResult.current = false
    setUsScore(initial?.us ?? 0)
    setThemScore(initial?.them ?? 0)
    setHtUs(initial?.ht_us ?? '')
    setHtThem(initial?.ht_them ?? '')
    const m = resolve(initial?.motm_profile_id, initial?.motm_name)
    setMotm(m.text); setMotmId(m.id)
    setMotmPhoto(initial?.motm_photo_url ?? null)
    setGoals((source.goals ?? []).map((g) => {
      const s = resolve(g.scorer_profile_id, g.scorer_name)
      const a = resolve(g.assist_profile_id, g.assist_name)
      return { scorer: s.text, scorerId: s.id, minute: g.minute ?? '', assist: a.text, assistId: a.id }
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fixture?.id])

  function match(name) {
    const n = (name || '').trim().toLowerCase()
    if (!n) return { id: null, name: null }
    const hit = people.find((s) => s.name.toLowerCase() === n)
    return hit ? { id: hit.id, name: null } : { id: null, name: name.trim() }
  }
  // A carried id wins; otherwise resolve what was typed.
  const pick = (text, id) => (id ? { id, name: null } : match(text))

  function addGoal() {
    setPicker('scorer-' + goals.length)
    setGoals(g => [...g, { scorer: '', scorerId: null, minute: '', assist: '', assistId: null }])
  }
  function rmGoal(i) {
    setPicker(null)
    setGoals(g => g.filter((_, idx) => idx !== i))
  }
  const setGoal = (i, key, val, id = null) => setGoals((g) => g.map((row, idx) => {
    if (idx !== i) return row
    const next = { ...row, [key]: val }
    if (key === 'scorer') next.scorerId = id
    if (key === 'assist') next.assistId = id
    return next
  }))

  async function onSubmit(e) {
    e.preventDefault()
    if (pending[fixture.id]) return
    setError(null)
    if (!navigator.onLine) {
      setError("You're offline. Reconnect to save the result.")
      return
    }
    const us = Number(usScore) || 0, them = Number(themScore) || 0
    // Given = either box has something in it; the other side then counts as nil.
    const htGiven = String(htUs ?? '').trim() !== '' || String(htThem ?? '').trim() !== ''
    const ht = htGiven ? { ht_us: Number(htUs) || 0, ht_them: Number(htThem) || 0 } : null
    if (ht && (ht.ht_us > us || ht.ht_them > them)) {
      setError("Half time can't be higher than full time. Check the scores.")
      return
    }
    const current = () => visibleFixture.current === fixture.id
    let scoreWritten = wroteResult.current
    try {
      const m = pick(motm, motmId)
      // Blank half time is LEFT OUT of the row rather than sent as 0: the
      // database then stores NULL (0039), and an edit leaves a row that never
      // had one alone. Only a half time that was there and has been cleared is
      // written as NULL.
      const hadHt = existing?.ht_us != null || existing?.ht_them != null
      const row = {
        fixture_id: fixture.id,
        us, them,
        ...(ht ?? (hadHt ? { ht_us: null, ht_them: null } : {})),
        motm_profile_id: m.id, motm_name: m.name, motm_photo_url: motmPhoto,
      }
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
      const submitted = { ...fixture, result: row, goals: rows }
      setPending(all => ({ ...all, [fixture.id]: submitted }))
      haptic('tap', heading.current)
      // Replacing a result is only safe when this form was opened WITH it — the
      // fields above were then prefilled from the stored row. A fixture handed
      // over without a result is not proof none exists (the Fixtures calendar
      // lists played games without theirs; another manager's list can be stale),
      // and an upsert from that blank form overwrote the score and MOTM and went
      // on to delete every goal. So a new result is an INSERT: results.fixture_id
      // is the primary key, and the database refuses a second one.
      const replacing = !!existing || wroteResult.current
      const { error: rErr } = replacing
        ? await supabase.from('results').upsert(row, { onConflict: 'fixture_id' })
        : await supabase.from('results').insert(row)
      if (rErr?.code === '23505' && !replacing) {
        // A result is already stored. One case is ours: the first tap's insert
        // landed but its response was lost (pitch-side signal), so this is the
        // retry. If what is stored is EXACTLY what we are sending and it has no
        // goals yet, carrying on changes nothing that exists — it only adds the
        // scorers that never got saved. Anything else is somebody else's result.
        const [stored, anyGoal] = await Promise.all([
          supabase.from('results').select(RESULT_FIELDS.join(', ')).eq('fixture_id', fixture.id).maybeSingle(),
          supabase.from('goals').select('id').eq('fixture_id', fixture.id).limit(1),
        ])
        if (stored.error) throw stored.error
        if (anyGoal.error) throw anyGoal.error
        const ours = !!stored.data
          // A half time we left out is stored as NULL, or as the 0 the column
          // defaulted to before 0039: both are "what we sent".
          && RESULT_FIELDS.every((k) => (
            (k === 'ht_us' || k === 'ht_them') && !(k in row)
              ? stored.data[k] == null || stored.data[k] === 0
              : (stored.data[k] ?? null) === (row[k] ?? null)
          ))
          && (anyGoal.data ?? []).length === 0
        if (!ours) {
          haptic('warn', current() ? heading.current : null)
          if (current()) setError('Result already logged. Edit in Results.')
          onStale?.() // the list behind is stale: refresh it so the game moves to played
          return
        }
      } else if (rErr) {
        throw rErr
      }
      scoreWritten = true

      // Replace the goal set (simplest correct approach for an edit). If the
      // delete fails we MUST stop: inserting on top would double every goal.
      const { error: dErr } = await supabase.from('goals').delete().eq('fixture_id', fixture.id)
      if (dErr) throw dErr
      if (rows.length) {
        const { error: gErr } = await supabase.from('goals').insert(rows)
        if (gErr) throw gErr
      }

      // Full time confirmed — one of the three moments DESIGN-SYSTEM §5 names as
      // worth a haptic. Fires after every write landed, never on submit.
      haptic('success', current() ? heading.current : null)
      onSaved(submitted)
      if (current()) onClose()
    } catch (err) {
      haptic('warn', current() ? heading.current : null)
      if (current()) {
        wroteResult.current = scoreWritten
        setError(friendlyError(err, "Couldn't save the result. Try again."))
      }
      // The score went in but a later step did not: the game now HAS a result,
      // so the list behind should stop offering it as "needs a result".
      if (scoreWritten) onStale?.()
    } finally {
      setPending(all => {
        const next = { ...all }
        delete next[fixture.id]
        return next
      })
    }
  }

  if (!fixture) return <Sheet open={false} onClose={onClose} />
  const us = teamLabel(fixture.team)
  const them = fixture.opponent?.name

  // Scorers named vs goals claimed. A blank scorer row doesn't count — it's a
  // row the manager has opened but not filled, not a goal accounted for.
  const scoredFor = Number(usScore) || 0
  const named = goals.filter((g) => g.scorer.trim()).length
  const unaccounted = scoredFor - named
  const submitted = pending[fixture.id]

  return (
    <Sheet open={open} onClose={onClose}>
      <Toast message={error} onDismiss={() => setError(null)} />

      {!submitted && <p className="kicker"><span className="kicker-rule">{existing ? 'EDIT RESULT' : 'LOG RESULT'}</span></p>}
      <h2 ref={heading} className="display mt-2" style={{ fontSize: 'var(--type-title)' }}>{submitted ? 'Full time' : `${teamMatchName(fixture.team)} v ${them}`}</h2>

      {submitted && (
        <div className="result-preview mt-4" role="status" aria-label="Saving result">
          <ScoreBug fixture={submitted} />
          <p className="save-progress">Saving result…</p>
        </div>
      )}
      {!submitted && <form id={formId} className="col gap-4 mt-4" onSubmit={onSubmit}>
        {/* Each box is named above it. It used to be two unlabelled boxes with a
            trailing "1st Team / Wollaton" caption, so the only way to know which
            score was yours was to read past both and map left-to-right. On the
            one screen where getting it backwards silently inverts a W into an L. */}
        <div>
          <p className="label">Full time</p>
          <div className="score-row mt-2">
            <div className="score-cell">
              <span className="score-team">{us}</span>
              <input className="input score-in" type="number" min="0" value={usScore} onChange={(e) => setUsScore(e.target.value)} aria-label={`${us} score`} />
            </div>
            <span className="score-sep mono">–</span>
            <div className="score-cell">
              <span className="score-team">{them}</span>
              <input className="input score-in" type="number" min="0" value={themScore} onChange={(e) => setThemScore(e.target.value)} aria-label={`${them} score`} />
            </div>
          </div>
        </div>

        <div>
          <p className="label">Half time <span className="dim">· optional</span></p>
          <div className="score-row mt-2">
            <div className="score-cell">
              <input className="input score-in sm" type="number" inputMode="numeric" min="0" placeholder="–" value={htUs} onChange={(e) => setHtUs(e.target.value)} aria-label={`${us} half-time score`} />
            </div>
            <span className="score-sep mono">–</span>
            <div className="score-cell">
              <input className="input score-in sm" type="number" inputMode="numeric" min="0" placeholder="–" value={htThem} onChange={(e) => setHtThem(e.target.value)} aria-label={`${them} half-time score`} />
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
              Scorers missing · {unaccounted} of {scoredFor}
            </p>
          )}
          {unaccounted < 0 && (
            <p className="goal-check over mono mt-2" role="status">
              Scorers named · {named} for {scoredFor} {scoredFor === 1 ? 'goal' : 'goals'}
            </p>
          )}

          <div className="col gap-2 mt-2">
            {goals.length === 0 && <p className="dim" style={{ fontSize: 'var(--type-sm)' }}>No scorers yet.</p>}
            {goals.map((g, i) => (
              <div key={i} className="goal-row card">
                <div className="goal-entry">
                  <SquadName squad={squad} label={`Scorer for goal ${i + 1}`} placeholder="Scorer" value={g.scorer}
                    expanded={picker === 'scorer-' + i} onOpen={() => setPicker('scorer-' + i)} onClose={() => setPicker(null)}
                    onChange={(name, id) => {
                      setGoal(i, 'scorer', name, id)
                      if (id) setPicker(g.assist ? null : 'assist-' + i)
                    }} />
                  <input className="input min-in" type="number" inputMode="numeric" aria-label={`Minute for goal ${i + 1}`} min="0" max="120" placeholder="min" value={g.minute} onChange={(e) => setGoal(i, 'minute', e.target.value)} />
                  <button type="button" className="goal-rm" onClick={() => rmGoal(i)} aria-label={`Remove goal ${i + 1}`}>✕</button>
                </div>
                <div className="mt-2">
                  <SquadName squad={squad} label={`Assist for goal ${i + 1}`} placeholder="Assist (optional)" value={g.assist}
                    expanded={picker === 'assist-' + i} onOpen={() => setPicker('assist-' + i)} onClose={() => setPicker(null)}
                    onChange={(name, id) => { setGoal(i, 'assist', name, id); if (id) setPicker(null) }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="label">Man of the match</label>
          <SquadName squad={squad} label="Man of the match" placeholder="Pick or type a name" value={motm}
            expanded={picker === 'motm'} onOpen={() => setPicker('motm')} onClose={() => setPicker(null)}
            onChange={(name, id) => { setMotm(name); setMotmId(id); if (id) setPicker(null) }} />
          <div className="row gap-2 mt-2" style={{ alignItems: 'center' }}>
            <ImageUpload
              folder="motm" shape="square" maxDim={1000} current={motmPhoto}
              label={motmPhoto ? 'Change MOTM photo' : 'Add a MOTM photo'}
              onUploaded={(url) => setMotmPhoto(url)}
            />
            {motmPhoto && (
              <button type="button" className="chip" onClick={() => setMotmPhoto(null)} style={{ color: 'var(--red-bright)' }}>Remove</button>
            )}
          </div>
        </div>

      </form>}
      {!submitted && <div className="sheet-actions mt-4">
        <button type="submit" form={formId} className="btn btn-primary btn-block">
          {existing ? 'Save result' : 'Log result'}
        </button>
      </div>}

      <style>{`
        .score-row { display: flex; align-items: flex-end; gap: var(--space-2); }
        .score-cell { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
        /* The team name sits over its own box and is allowed to be narrow —
           truncated beats pushing the boxes off a phone screen. */
        .score-team { font-size: var(--type-xs); font-weight: 650;
          color: var(--bone-mute); max-width: 96px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .score-in { width: 84px; text-align: center; font-family: var(--font-mono); font-size: var(--type-title);
          padding-inline: var(--space-1); }
        .score-in.sm { width: 64px; font-size: var(--type-lead); }
        .score-sep { color: var(--bone-dim); font-size: var(--type-lg); padding-bottom: var(--space-3); }
        .min-in { width: 68px; text-align: center; font-family: var(--font-mono); }
        .goal-row { padding: var(--space-2); }
        /* A quiet icon target, not a full ghost button — removing one goal row is
           not a peer of the form's actual actions. 40px keeps it tappable. */
        .goal-rm { width: 40px; height: 40px; flex: none; align-self: center;
          background: none; border: 1px solid var(--line); border-radius: var(--r-input);
          color: var(--bone-mute); font-size: var(--type-sm); line-height: 1;
          transition: color var(--t-fast), border-color var(--t-fast); }
        .goal-rm:hover { color: var(--red-bright); border-color: var(--red); }
        .goal-check { font-size: var(--type-caption); color: var(--amber); letter-spacing: .02em; }
        .goal-check.over { color: var(--bone-mute); }
      `}</style>
    </Sheet>
  )
}

// Keep the guest name as entered. A picked teammate carries their profile id,
// even where two squad members share a name. Only the active field opens.
function SquadName({ squad, label, placeholder, value, onChange, expanded, onOpen, onClose }) {
  const matches = squad.filter(p => p.name.toLowerCase().includes(value.trim().toLowerCase()))
  return (
    <div className="squad-name" onBlur={e => {
      if (expanded && !e.currentTarget.contains(e.relatedTarget)) onClose()
    }} onKeyDown={e => {
      if (expanded && e.key === 'Escape') {
        e.stopPropagation()
        e.currentTarget.querySelector('input')?.focus()
        onClose()
      }
    }}>
      <input className="input" aria-label={label} autoComplete="off" placeholder={placeholder}
        value={value} onChange={e => { onChange(e.target.value, null); onOpen() }}
        onFocus={onOpen} onClick={onOpen} />
      {expanded && matches.length > 0 && (
        <div className="squad-options" role="group" aria-label={`Choose ${label.toLowerCase()}`}>
          {matches.map(p => <button key={p.id} type="button" className="chip" onMouseDown={e => e.preventDefault()}
            onClick={() => onChange(p.name, p.id)}>{p.name}</button>)}
        </div>
      )}
    </div>
  )
}
