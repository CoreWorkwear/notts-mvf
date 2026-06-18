import { POSITIONS } from './constants'
import { isSquadMember } from './players'
import { formationSlots } from './lineup'

// Squad page (§4.1): group the squad by position in football order — keepers,
// then defenders, midfielders, forwards — using each player's PREFERRED position
// (falling back to their first listed position). Anyone without a position lands
// in a trailing "Squad" group so nobody is dropped.
export const POSITION_GROUPS = [
  { key: 'GK', label: 'Goalkeepers', positions: ['GK'] },
  { key: 'DEF', label: 'Defenders', positions: ['RB', 'CB', 'LB'] },
  { key: 'MID', label: 'Midfielders', positions: ['CDM', 'CM', 'CAM', 'RM', 'LM'] },
  { key: 'FWD', label: 'Forwards', positions: ['RW', 'LW', 'ST', 'CF'] },
]

const groupOf = (pos) => POSITION_GROUPS.find((g) => g.positions.includes(pos))?.key ?? null
const posRank = (pos) => { const i = POSITIONS.indexOf(pos); return i === -1 ? 99 : i }
const surname = (p) => (p.last_name || p.first_name || '').toLowerCase()

// A player's primary position = preferred, else the first listed.
export function primaryPosition(p) {
  return p.preferred || (Array.isArray(p.positions) && p.positions[0]) || null
}

// Returns [{ key, label, players: [...] }] for non-empty groups, in football order,
// with an "Unassigned" group last if anyone has no recognised position. Each group's
// players are sorted by position rank then surname. Only real squad members
// (active, approved, a player — not supporters/pending) are included.
export function squadByPosition(players = []) {
  const squad = players.filter(isSquadMember)
  const buckets = new Map(POSITION_GROUPS.map((g) => [g.key, []]))
  const unassigned = []

  for (const p of squad) {
    const g = groupOf(primaryPosition(p))
    if (g) buckets.get(g).push(p); else unassigned.push(p)
  }

  const sortPlayers = (list) =>
    [...list].sort((a, b) => posRank(primaryPosition(a)) - posRank(primaryPosition(b)) || surname(a).localeCompare(surname(b)))

  const groups = POSITION_GROUPS
    .map((g) => ({ key: g.key, label: g.label, players: sortPlayers(buckets.get(g.key)) }))
    .filter((g) => g.players.length)

  if (unassigned.length) groups.push({ key: 'NA', label: 'Squad', players: [...unassigned].sort((a, b) => surname(a).localeCompare(surname(b))) })
  return groups
}

// Depth chart (§4.2): for a position, the squad members who can play it — those
// who PREFER it first (marked), then anyone who lists it as one of their
// positions, each sorted by surname. No ability ratings exist, so "depth" is
// who-can-play + preferred-first, not a power ranking.
export function positionDepth(players = [], pos) {
  const can = players.filter(isSquadMember).filter((p) => p.preferred === pos || (Array.isArray(p.positions) && p.positions.includes(pos)))
  return can
    .map((p) => ({ ...p, isPreferred: primaryPosition(p) === pos }))
    .sort((a, b) => (b.isPreferred - a.isPreferred) || surname(a).localeCompare(surname(b)))
}

// Lay the depth onto a formation's slots for the pitch: each position's depth list
// is dealt across that position's slots in order (two CB slots get the 1st and 2nd
// choice CBs, etc.). Returns { slotIndex: profileId } for the first-choice spread.
export function depthChartStarters(players = [], formation) {
  const slots = formationSlots(formation)
  const used = new Set()
  const byPos = {}
  for (const s of slots) (byPos[s.pos] ??= []).push(s.slot)
  const starters = {}
  for (const [pos, slotIdxs] of Object.entries(byPos)) {
    const depth = positionDepth(players, pos)
    let di = 0
    for (const slotIdx of slotIdxs) {
      // Skip players already placed in another slot of the same position spread.
      while (di < depth.length && used.has(depth[di].id)) di++
      if (di < depth.length) { starters[slotIdx] = depth[di].id; used.add(depth[di].id); di++ }
    }
  }
  return starters
}
