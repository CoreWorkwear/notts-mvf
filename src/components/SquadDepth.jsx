import { useMemo, useState } from 'react'
import PitchView from './PitchView'
import { depthPitchSlots, depthPitchStarters, positionDepth } from '../lib/squadList'

const initials = (p) => `${(p.first_name?.[0] ?? '')}${(p.last_name?.[0] ?? '')}`.toUpperCase()
const fullName = (p) => `${p.first_name} ${p.last_name}`.trim()

const POS_LABEL = {
  GK: 'Goalkeepers', RB: 'Right-backs', CB: 'Centre-backs', LB: 'Left-backs',
  CDM: 'Holding midfielders', CM: 'Central midfielders', CAM: 'Attacking midfielders',
  RM: 'Right midfielders', LM: 'Left midfielders', RW: 'Right wingers', LW: 'Left wingers',
  ST: 'Strikers', CF: 'Centre-forwards',
}

// One clean line per player: avatar · name · preferred/can-play tag.
function DepthRow({ p }) {
  return (
    <div className="card sd-row">
      {p.photo_url
        ? <img className="sd-av" src={p.photo_url} alt="" />
        : <span className="sd-av mono">{initials(p)}</span>}
      <span className="sd-name">{fullName(p)}</span>
      <span className={'sd-tag mono' + (p.isPreferred ? ' pref' : '')}>{p.isPreferred ? 'Preferred' : 'Can play'}</span>
    </div>
  )
}

// §4.2 — FM-style squad depth. The pitch shows EVERY position (not a formation),
// each with its first-choice player; tap a position and the depth for it appears in
// the panel ABOVE the pitch — preferred players first, then those who can cover.
export default function SquadDepth({ players = [] }) {
  const [sel, setSel] = useState(null) // { slot, pos }

  const slots = useMemo(() => depthPitchSlots(), [])
  const slotPos = useMemo(() => Object.fromEntries(slots.map((s) => [s.slot, s.pos])), [slots])
  const names = useMemo(() => Object.fromEntries(players.map((p) => [p.id, fullName(p)])), [players])
  const photos = useMemo(() => Object.fromEntries(players.filter((p) => p.photo_url).map((p) => [p.id, p.photo_url])), [players])
  const starters = useMemo(() => depthPitchStarters(players), [players])

  const depth = sel ? positionDepth(players, sel.pos) : []

  return (
    <div className="mt-3">
      {/* The depth list sits ABOVE the pitch so both stay on screen. */}
      <div className="depth-panel">
        {!sel ? (
          <p className="dim" style={{ fontSize: 13, margin: 0 }}>Tap a position on the pitch to see who can play there — first choice first.</p>
        ) : (
          <>
            <p className="kicker"><span className="kicker-rule">{sel.pos}</span> <span className="dp-count mono">{depth.length}</span></p>
            <h3 className="dp-title">{POS_LABEL[sel.pos] ?? sel.pos}</h3>
            {depth.length === 0 && <p className="dim" style={{ fontSize: 13 }}>Nobody can play here yet.</p>}
            <div className="col gap-2 mt-2">
              {depth.map((p) => <DepthRow key={p.id} p={p} />)}
            </div>
          </>
        )}
      </div>

      <p className="dim mt-3" style={{ fontSize: 12 }}>First choice in each position. Tap a shirt for the depth.</p>
      <div className="mt-2">
        <PitchView
          slots={slots}
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
        .sd-row { display: flex; align-items: center; gap: 12px; padding: 8px 12px; }
        .sd-av { width: 34px; height: 34px; border-radius: 50%; flex: none; object-fit: cover;
          display: grid; place-items: center; background: var(--slate); border: 1px solid var(--line-2);
          font-size: 12px; font-weight: 600; color: var(--bone-mute); }
        .sd-name { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sd-tag { flex: none; font-size: 10px; letter-spacing: .04em; text-transform: uppercase;
          color: var(--bone-mute); border: 1px solid var(--line); border-radius: 6px; padding: 3px 8px; }
        .sd-tag.pref { color: var(--green-bright); border-color: var(--green); }
      `}</style>
    </div>
  )
}
