import { useMemo, useState } from 'react'
import PitchView from './PitchView'
import Sheet from './Sheet'
import { FORMATION_NAMES, DEFAULT_FORMATION, formationSlots } from '../lib/lineup'
import { depthChartStarters, positionDepth } from '../lib/squadList'

const initials = (p) => `${(p.first_name?.[0] ?? '')}${(p.last_name?.[0] ?? '')}`.toUpperCase()
const fullName = (p) => `${p.first_name} ${p.last_name}`.trim()

// Position-code → readable heading for the depth sheet.
const POS_LABEL = {
  GK: 'Goalkeepers', RB: 'Right-backs', CB: 'Centre-backs', LB: 'Left-backs',
  CDM: 'Holding midfielders', CM: 'Central midfielders', CAM: 'Attacking midfielders',
  RM: 'Right midfielders', LM: 'Left midfielders', RW: 'Right wingers', LW: 'Left wingers',
  ST: 'Strikers', CF: 'Centre-forwards',
}

// §4.2 — FM-style depth chart. The formation pitch shows the first-choice player in
// each slot (depth dealt across duplicate slots); tap a position to see everyone
// who can play there, in depth order. Read-only, player-facing.
export default function SquadDepth({ players = [] }) {
  const [formation, setFormation] = useState(DEFAULT_FORMATION)
  const [openPos, setOpenPos] = useState(null)

  const names = useMemo(() => Object.fromEntries(players.map((p) => [p.id, fullName(p)])), [players])
  const photos = useMemo(() => Object.fromEntries(players.filter((p) => p.photo_url).map((p) => [p.id, p.photo_url])), [players])
  const starters = useMemo(() => depthChartStarters(players, formation), [players, formation])
  const slotPos = useMemo(() => Object.fromEntries(formationSlots(formation).map((s) => [s.slot, s.pos])), [formation])

  const depth = openPos ? positionDepth(players, openPos) : []

  return (
    <div className="mt-4">
      <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
        {FORMATION_NAMES.map((f) => (
          <button key={f} className="chip" aria-pressed={formation === f} onClick={() => setFormation(f)}>{f}</button>
        ))}
      </div>

      <p className="dim mt-3" style={{ fontSize: 12 }}>First choice in each position. Tap a shirt for the full depth.</p>

      <div className="mt-2">
        <PitchView
          formation={formation}
          starters={starters}
          names={names}
          photos={photos}
          onTapSlot={(slot) => setOpenPos(slotPos[slot])}
        />
      </div>

      <Sheet open={!!openPos} onClose={() => setOpenPos(null)}>
        <p className="kicker"><span className="kicker-rule">{openPos}</span></p>
        <h2 className="display mt-2" style={{ fontSize: 24 }}>{POS_LABEL[openPos] ?? openPos}</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
          {depth.length ? `${depth.length} can play here` : 'Nobody listed here yet'}
        </p>

        <div className="col gap-2 mt-4">
          {depth.map((p, i) => (
            <div key={p.id} className="card sd-row">
              <span className="sd-rank mono">{i + 1}</span>
              {p.photo_url
                ? <img className="sd-av" src={p.photo_url} alt="" />
                : <span className="sd-av mono">{initials(p)}</span>}
              <span className="sd-main">
                <span className="sd-name">{fullName(p)}</span>
                <span className="sd-meta mono">{(p.positions ?? []).join(' · ') || '—'}</span>
              </span>
              <span className={'sd-tag mono' + (p.isPreferred ? ' pref' : '')}>{p.isPreferred ? 'Preferred' : 'Can cover'}</span>
            </div>
          ))}
        </div>
      </Sheet>

      <style>{`
        .sd-row { display: flex; align-items: center; gap: 12px; padding: 10px 14px; }
        .sd-rank { flex: none; width: 18px; text-align: center; color: var(--bone-mute); font-size: 13px; }
        .sd-av { width: 38px; height: 38px; border-radius: 50%; flex: none; object-fit: cover;
          display: grid; place-items: center; background: var(--slate); border: 1px solid var(--line-2);
          font-size: 12px; font-weight: 600; color: var(--bone-mute); }
        .sd-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .sd-name { font-weight: 600; }
        .sd-meta { font-size: 11px; color: var(--bone-mute); letter-spacing: .02em; }
        .sd-tag { flex: none; font-size: 10px; letter-spacing: .04em; text-transform: uppercase;
          color: var(--bone-mute); border: 1px solid var(--line); border-radius: 6px; padding: 3px 8px; }
        .sd-tag.pref { color: var(--green-bright); border-color: var(--green); }
      `}</style>
    </div>
  )
}
