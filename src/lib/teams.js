// How a team is shown in a MATCHUP or the league table — its competitive name
// (e.g. the First Team competes as "Nottingham"), falling back to the internal
// tier label ("First Team" / "Community"). Squad controls (filters, stats
// scope) keep the label; matchups use this.
export const teamMatchName = (team) => team?.match_name || team?.label || ''

// "Us v Them" for a fixture, home team named first.
export function fixtureMatchup(f) {
  const us = teamMatchName(f?.team)
  const them = f?.opponent?.name ?? 'TBC'
  return f?.home_away === 'Home' ? `${us} v ${them}` : `${them} v ${us}`
}
