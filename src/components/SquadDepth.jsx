import { useMemo, useState } from 'react'
import PitchView from './PitchView'
import { FORMATION_NAMES, DEFAULT_FORMATION, formationSlots } from '../lib/lineup'
import { depthChartStarters, positionDepth } from '../lib/squadList'

const initials = (p) => `${(p.first_name?.[0] ?? '')}${(p.last_name?.[0] ?? '')}`.toUpperCase()
const fullName = (p) => `${p.first_name} ${p.last_name}`.trim()

const POS_LABEL = {
  GK: 'Goalkeepers', RB: 'Right-backs', CB: 'Centre-backs', LB: 'Left-backs',
  CDM: 'Holding midfielders', CM: 'Central midfielders', CAM: 'Attacking midfielders',
  RM: 'Right midfielders', LM: 'Left midfielders', RW: 'Right wingers', LW: 'Left wingers',
  ST: 'Strikers', CF: 'Centre-forwards',
}

function DepthRow({ p }) {
  return (
    <div className="card sd-row">
      {p.photo_url
        ? <img className="sd-av" src={p.photo_url} alt="" />
        : <span className="sd-av mono">{initials(p)}</span>}
      <span className="sd-main">
        <span className="sd-name">{fullName(p)}</span>
        <span className="sd-meta mono">{(p.positions ?? []).join(' · ') || '—'}</span>
      </span>
    </div>
  )
}

// §4.2 — FM-style depth chart. Tap a position on the pitch and the full depth for
// it appears in the panel ABOVE the pitch (so the pitch stays visible) — players
// who PREFER that position first, then anyone who can cover it below. The pitch
// shows the first-choice in each slot; a formation selector reshapes it.
export default function SquadDepth({ players = [] }) {
  const [formation, setFormation] = useState(DEFAULT_FORMATION)
  const [sel, setSel] = useState(null) // { slot, pos }

  const names = useMemo(() => Object.fromEntries(players.map((p) => [p.id, fullName(p)])), [players])
  const photos = useMemo(() => Object.fromEntries(players.filter((p) => p.photo_url).map((p) => [p.id, p.photo_url])), [players])
  const starters = useMemo(() => depthChartStarters(players, formation), [players, formation])
  const slotPos = useMemo(() => Object.fromEntries(formationSlots(formation).map((s) => [s.slot, s.pos])), [formation])

  const depth = sel ? positionDepth(players, sel.pos) : []
  const preferred = depth.filter((p) => p.isPreferred)
  const cover = depth.filter((p) => !p.isPreferred)

  return (
    <div className="mt-3">
      <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
        {FORMATION_NAMES.map((f) => (
          <button key={f} className="chip" aria-pressed={formation === f} onClick={() => setFormation(f)}>{f}</button>
        ))}
      </div>

      {/* The depth list sits ABOVE the pitch so both stay on screen. */}
      <div className="depth-panel mt-3">
        {!sel ? (
          <p className="dim" style={{ fontSize: 13, margin: 0 }}>Tap a position on the pitch to see who plays there — first choice first.</p>
        ) : (
          <>
            <p className="kicker"><span className="kicker-rule">{sel.pos}</span> <span className="dp-count mono">{depth.length}</span></p>
            <h3 className="dp-title">{POS_LABEL[sel.pos] ?? sel.pos}</h3>
            {depth.length === 0 && <p className="dim" style={{ fontSize: 13 }}>Nobody listed here yet.</p>}
            <div className="col gap-2 mt-2">
              {preferred.map((p) => <DepthRow key={p.id} p={p} />)}
            </div>
            {cover.length > 0 && <p className="dp-sub mono">Can also cover</p>}
            <div className="col gap-2">
              {cover.map((p) => <DepthRow key={p.id} p={p} />)}
            </div>
          </>
        )}
      </div>

      <p className="dim mt-3" style={{ fontSize: 12 }}>First choice in each position. Tap a shirt for the depth.</p>
      <div className="mt-2">
        <PitchView
          formation={formation}
          starters={starters}
          names={names}
          photos={photos}
          activeSlot={sel?.slot}
          onTapSlot={(slot) => setSel({ slot, pos: slotPos[slot] })}
        />
      </div>

      <style>{`
        .depth-panel { background: var(--coal); border: 1px solid var(--line); border-radius: var(--r-card);
          padding: 12px 14px; max-height: 40vh; overflow-y: auto; overscroll-behavior: contain; }
        .dp-count { color: var(--bone-mute); font-size: 12px; margin-left: 6px; }
        .dp-title { font-family: var(--font-display); font-size: 20px; margin: 2px 0 0; }
        .dp-sub { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--bone-mute); margin: 12px 0 6px; }
        .sd-row { display: flex; align-items: center; gap: 12px; padding: 8px 12px; }
        .sd-av { width: 36px; height: 36px; border-radius: 50%; flex: none; object-fit: cover;
          display: grid; place-items: center; background: var(--slate); border: 1px solid var(--line-2);
          font-size: 12px; font-weight: 600; color: var(--bone-mute); }
        .sd-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .sd-name { font-weight: 600; }
        .sd-meta { font-size: 11px; color: var(--bone-mute); letter-spacing: .02em; }
      `}</style>
    </div>
  )
}
