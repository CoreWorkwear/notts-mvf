// Who counts as "the squad" for a push (plain ESM, vitest-tested).
// Shared by send-push (fixture path) and run-reminders so the two can't drift.

// team_memberships rows embedded with profiles!inner(active, approved, is_player)
// → the profile ids of approved, active PLAYERS. Supporters, pending signups
// and soft-removed players are never pushed at as part of a squad.
export function activeRoster(members) {
  return (members ?? [])
    .filter((m) => m?.profiles?.active === true && m?.profiles?.approved === true && m?.profiles?.is_player === true)
    .map((m) => m.profile_id)
}

// availability rows → { [profile_id]: status }
export function statusMap(avail) {
  const out = {}
  for (const a of avail ?? []) if (a?.profile_id) out[a.profile_id] = a.status
  return out
}
