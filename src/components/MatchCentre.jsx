import { useEffect, useState } from 'react'
import Sheet from './Sheet'
import ScoreBug from './ScoreBug'
import { supabase } from '../lib/supabase'
import { resolveName, outcome } from '../hooks/useResults'
import { fmtDateLong } from '../lib/format'
import { heroBackground } from '../lib/media'

// Match centre (HANDOVER §5): big FT score + HT, MOTM with a star, the goal
// timeline, and the squad that played with goals/assists tallied per name.
export default function MatchCentre({ open, onClose, fixture, isAdmin, pool = [], onEdit }) {
  const [played, setPlayed] = useState([]) // [{id, name}] who were marked in

  useEffect(() => {
    if (!open || !fixture) return
    supabase
      .from('availability')
      .select('status, profile:profiles(id, first_name, last_name)')
      .eq('fixture_id', fixture.id)
      .eq('status', 'in')
      .then(({ data }) => setPlayed((data ?? []).map((a) => ({
        id: a.profile?.id, name: `${a.profile?.first_name ?? ''} ${a.profile?.last_name ?? ''}`.trim(),
      }))))
  }, [open, fixture])

  if (!fixture) return null
  const f = fixture
  const r = f.result
  const sb = f.squadById ?? {}
  const isXL = f.team?.key === 'xl'
  const grad = isXL ? 'var(--grad-xl)' : 'var(--grad-community)'
  const res = outcome(r)
  const motm = resolveName(sb, r.motm_profile_id, r.motm_name)

  // Tally goals/assists per resolved name (key by profile_id then free name).
  const tally = {}
  const bump = (key, field) => { if (!key) return; tally[key] = tally[key] || { g: 0, a: 0 }; tally[key][field]++ }
  for (const g of f.goals) {
    bump(resolveName(sb, g.scorer_profile_id, g.scorer_name), 'g')
    bump(resolveName(sb, g.assist_profile_id, g.assist_name), 'a')
  }
  // Squad list = those marked in, merged with anyone in the tally (guests).
  const names = new Set(played.map((p) => p.name).filter(Boolean))
  Object.keys(tally).forEach((n) => names.add(n))

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="mc-hero" style={{ backgroundImage: heroBackground({ pinnedUrl: f.pinnedUrl, pool, seed: f.id, gradient: grad }), backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <div className="row spread">
          <span className="kicker" style={{ color: 'rgba(255,255,255,.85)' }}>FULL TIME · {f.fixture_type}</span>
          {isAdmin && <button className="btn btn-ghost mc-edit" onClick={onEdit}>Edit</button>}
        </div>
        <div className="mt-3"><ScoreBug fixture={f} size="lg" /></div>
        <p className="mono center mt-3" style={{ color: 'rgba(255,255,255,.85)', fontSize: 12 }}>
          HT {r.ht_us}–{r.ht_them} · {fmtDateLong(f.match_date)}
        </p>
      </div>

      {motm && (
        <div className="mc-motm mt-4">
          <span className="mc-star">★</span>
          <div><span className="kicker">MAN OF THE MATCH</span><div style={{ fontWeight: 600 }}>{motm}</div></div>
        </div>
      )}

      <p className="kicker mt-5"><span className="kicker-rule">GOALS</span></p>
      {f.goals.length === 0 ? (
        <p className="dim mt-2" style={{ fontSize: 14 }}>{res === 'L' || r.us === 0 ? 'None for us this time.' : '—'}</p>
      ) : (
        <div className="mc-timeline mt-3">
          {f.goals.map((g) => {
            const scorer = resolveName(sb, g.scorer_profile_id, g.scorer_name) || 'Unknown'
            const assist = resolveName(sb, g.assist_profile_id, g.assist_name)
            return (
              <div key={g.id} className="mc-goal">
                <span className="mc-min mono">{g.minute != null ? `${g.minute}'` : '⚽'}</span>
                <span className="mc-dot" />
                <div>
                  <div style={{ fontWeight: 600 }}>{scorer}</div>
                  {assist && <div className="muted" style={{ fontSize: 13 }}>assist · {assist}</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {names.size > 0 && (
        <>
          <p className="kicker mt-5"><span className="kicker-rule">THE SQUAD</span></p>
          <div className="mc-squad mt-3">
            {[...names].sort().map((n) => {
              const t = tally[n]
              return (
                <div key={n} className="mc-player">
                  <span>{n}</span>
                  {t && <span className="mono mc-ga">{t.g ? `${t.g}G` : ''}{t.g && t.a ? ' · ' : ''}{t.a ? `${t.a}A` : ''}</span>}
                </div>
              )
            })}
          </div>
        </>
      )}

      <style>{`
        .mc-hero { border-radius: var(--r-hero); padding: 16px; position: relative; }
        .mc-edit { padding: 5px 12px; font-size: 13px; background: rgba(0,0,0,.25); color: #fff; border-color: rgba(255,255,255,.25); }
        .mc-motm { display: flex; align-items: center; gap: 12px; background: var(--slate);
          border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; }
        .mc-star { color: var(--gold); font-size: 26px; }
        .mc-timeline { display: flex; flex-direction: column; }
        .mc-goal { display: grid; grid-template-columns: 40px 16px 1fr; align-items: center; gap: 8px; padding: 8px 0; }
        .mc-min { color: var(--bone-mute); font-size: 13px; }
        .mc-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); justify-self: center; }
        .mc-squad { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; }
        .mc-player { display: flex; justify-content: space-between; gap: 8px; padding: 6px 0;
          border-bottom: 1px solid var(--line); font-size: 14px; }
        .mc-ga { color: var(--gold); font-size: 12px; }
        @media (max-width: 480px){ .mc-squad { grid-template-columns: 1fr; } }
      `}</style>
    </Sheet>
  )
}
