// Stats engine. Everything keys by profile_id (HANDOVER §3 — never by name;
// free-typed guests have no profile_id and so don't pollute per-player tables).
// Each figure is split two ways: by team (xl / community) and by league vs
// friendly (everything that isn't a League fixture). The UI shows a combined
// headline with the L/F split beneath, and a Whole Club / XL / Community scope.

function blank() {
  return { xl: { l: 0, f: 0 }, community: { l: 0, f: 0 } }
}

// playedFixtures: [{ team:{key}, fixture_type, result:{motm_profile_id}, goals:[{scorer_profile_id, assist_profile_id}] }]
// appearances:    [{ profile_id, teamKey, isLeague }]
// names:          { profile_id: 'First Last' }
export function buildStats({ playedFixtures, appearances, names }) {
  const byId = {}
  const ensure = (id) => {
    if (!id) return null
    if (!byId[id]) byId[id] = { id, name: names[id] || 'Unknown', goals: blank(), assists: blank(), motm: blank(), apps: blank() }
    return byId[id]
  }

  for (const f of playedFixtures) {
    const tk = f.team?.key === 'community' ? 'community' : 'xl'
    const lf = f.fixture_type === 'League' ? 'l' : 'f'
    for (const g of f.goals ?? []) {
      const s = ensure(g.scorer_profile_id); if (s) s.goals[tk][lf]++
      const a = ensure(g.assist_profile_id); if (a) a.assists[tk][lf]++
    }
    const m = ensure(f.result?.motm_profile_id); if (m) m.motm[tk][lf]++
  }
  for (const ap of appearances) {
    const p = ensure(ap.profile_id); if (p) p.apps[ap.teamKey][ap.isLeague ? 'l' : 'f']++
  }
  return byId
}

function pick(stat, scope) {
  if (scope === 'xl') return { ...stat.xl }
  if (scope === 'community') return { ...stat.community }
  return { l: stat.xl.l + stat.community.l, f: stat.xl.f + stat.community.f }
}
function cell(stat, scope) { const { l, f } = pick(stat, scope); return { l, f, total: l + f } }

// Per-player rows for a scope ('whole' | 'xl' | 'community'), only those who
// actually have something in that scope.
export function statRows(byId, scope) {
  return Object.values(byId)
    .map((p) => ({
      id: p.id,
      name: p.name,
      goals: cell(p.goals, scope),
      assists: cell(p.assists, scope),
      motm: cell(p.motm, scope),
      apps: cell(p.apps, scope),
    }))
    .filter((r) => r.goals.total || r.assists.total || r.motm.total || r.apps.total)
}

// Golden boot — top scorer(s); handles ties by returning all on the max.
export function goldenBoot(rows) {
  const max = rows.reduce((m, r) => Math.max(m, r.goals.total), 0)
  if (max === 0) return { top: [], goals: 0 }
  return { goals: max, top: rows.filter((r) => r.goals.total === max).sort((a, b) => a.name.localeCompare(b.name)) }
}

// Top N for a metric ('goals'|'assists'|'apps'|'motm').
export function leaders(rows, key, n = 5) {
  return rows
    .filter((r) => r[key].total > 0)
    .sort((a, b) => b[key].total - a[key].total || a.name.localeCompare(b.name))
    .slice(0, n)
}

// League-table ordering: points, then goal difference, then goals for.
export function sortStandings(rows) {
  return [...rows].sort((a, b) =>
    b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.team_name.localeCompare(b.team_name))
}
