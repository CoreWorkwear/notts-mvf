// Formations for the starting XI picker. Each formation is lines from the back
// (GK) to the front (attack); the pitch renders them with the keeper at the
// bottom. Pure + unit-tested; the editor/board components consume these.

export const FORMATIONS = {
  '4-4-2':   [['GK'], ['LB', 'CB', 'CB', 'RB'], ['LM', 'CM', 'CM', 'RM'], ['ST', 'ST']],
  '4-3-3':   [['GK'], ['LB', 'CB', 'CB', 'RB'], ['CM', 'CM', 'CM'], ['LW', 'ST', 'RW']],
  '4-2-3-1': [['GK'], ['LB', 'CB', 'CB', 'RB'], ['CDM', 'CDM'], ['LW', 'CAM', 'RW'], ['ST']],
  '3-5-2':   [['GK'], ['CB', 'CB', 'CB'], ['LM', 'CM', 'CM', 'CM', 'RM'], ['ST', 'ST']],
  '5-3-2':   [['GK'], ['LWB', 'CB', 'CB', 'CB', 'RWB'], ['CM', 'CM', 'CM'], ['ST', 'ST']],
  '4-5-1':   [['GK'], ['LB', 'CB', 'CB', 'RB'], ['LM', 'CM', 'CM', 'CM', 'RM'], ['ST']],
}

export const FORMATION_NAMES = Object.keys(FORMATIONS)
export const DEFAULT_FORMATION = '4-4-2'

// Flatten a formation into ordered slots (GK = slot 0), each tagged with its
// line + position-in-line so the pitch can lay them out.
export function formationSlots(name) {
  const lines = FORMATIONS[name] || FORMATIONS[DEFAULT_FORMATION]
  const slots = []
  let i = 0
  lines.forEach((line, lineIdx) => {
    line.forEach((pos, colIdx) => {
      slots.push({ slot: i, pos, line: lineIdx, lineSize: line.length, col: colIdx })
      i++
    })
  })
  return slots // always 11
}

// Saved line-up rows → editor state. starters keyed by slot index; subs ordered.
export function rowsToState(rows) {
  const starters = {}
  const subs = []
  let formation = DEFAULT_FORMATION
  for (const r of rows ?? []) {
    if (r.formation) formation = r.formation
    if (r.role === 'sub') subs.push(r.profile_id)
    else if (r.slot != null) starters[r.slot] = r.profile_id
  }
  return { formation, starters, subs }
}

// Editor state → rows to persist (we replace the whole line-up on save).
export function stateToRows(fixtureId, { formation, starters, subs }) {
  const rows = []
  const slots = formationSlots(formation)
  for (const s of slots) {
    const pid = starters[s.slot]
    if (pid) rows.push({ fixture_id: fixtureId, profile_id: pid, role: 'start', position: s.pos, slot: s.slot, formation })
  }
  for (const pid of subs ?? []) {
    rows.push({ fixture_id: fixtureId, profile_id: pid, role: 'sub', position: null, slot: null, formation })
  }
  return rows
}

// How many of the 11 starting slots are filled.
export function filledCount(starters) {
  return Object.values(starters ?? {}).filter(Boolean).length
}

// Drag-and-drop result: swap the players in two slots, or — if the target is
// empty — move the dragged player there (vacating the source). Returns a new map.
export function swapStarters(starters, from, to) {
  if (from === to) return starters
  const n = { ...starters }
  const a = n[from], b = n[to]
  if (b == null) { delete n[from]; n[to] = a }
  else { n[from] = b; n[to] = a }
  return n
}
