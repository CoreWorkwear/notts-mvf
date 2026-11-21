import { TEAMS } from './constants'

// Some older exports and league-table rows carry only a squad label.
const firstTeamAlias = (name) => /^(?:xl(?: 11s)?|first team|1st team)$/i.test(name?.trim() ?? '')

export function teamLabel(team) {
  if (team?.key === 'xl' || (!team?.key && firstTeamAlias(team?.label))) return TEAMS.xl.label
  if (team?.key === 'community') return TEAMS.community.label
  return team?.label ?? ''
}

// A competitive name (e.g. Nottingham) takes precedence on a fixture or table.
export function teamMatchName(team) {
  if (firstTeamAlias(team?.match_name)) return TEAMS.xl.label
  return team?.match_name || teamLabel(team)
}

// "Us v Them" for a fixture, home team named first.
export function fixtureMatchup(f) {
  const us = teamMatchName(f?.team)
  const them = f?.opponent?.name ?? 'TBC'
  return f?.home_away === 'Home' ? `${us} v ${them}` : `${them} v ${us}`
}

// The score to print BESIDE fixtureMatchup: home side's goals first, so the
// figures line up with the names. `result` is stored us/them; printing that
// as-is next to a home-first label made every away result read backwards.
// (A score bug that labels each side itself — ScoreBug — can stay us-first.)
export function matchupScore(f) {
  const r = f?.result
  if (!r) return ''
  return f.home_away === 'Home' ? `${r.us}–${r.them}` : `${r.them}–${r.us}`
}

// "1–0" when a half-time score was recorded, else null. It is optional: a
// result logged without one stores NULL (migration 0039), and "HT 0–0" for a
// score nobody entered was a small lie on every such result.
export function halfTimeScore(result) {
  if (result?.ht_us == null || result?.ht_them == null) return null
  return `${result.ht_us}–${result.ht_them}`
}
