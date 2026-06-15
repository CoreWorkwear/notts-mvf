// Pure helpers for the Players admin — kept out of the component so they're
// easy to unit-test.

// Required fields enforced in the UI (the DB enforces NOT NULL too).
export function validatePlayer({ first_name, last_name, email, phone }, { needPassword, password } = {}) {
  if (!first_name?.trim()) return 'First name is required.'
  if (!last_name?.trim()) return 'Surname is required.'
  if (!email?.trim()) return 'Email is required.'
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return "That email doesn't look right."
  if (!phone?.trim()) return 'Phone is required.'
  if (needPassword && (!password || password.length < 6)) return 'Starter password must be at least 6 characters.'
  return null
}

// Work out which team_membership rows to add and which to remove, given the
// player's current team_ids and the keys ticked in the form.
export function diffMemberships(currentTeamIds, selectedKeys, teams) {
  const idByKey = Object.fromEntries(teams.map((t) => [t.key, t.id]))
  const selectedIds = selectedKeys.map((k) => idByKey[k]).filter(Boolean)
  const current = new Set(currentTeamIds)
  const selected = new Set(selectedIds)
  return {
    toAdd: selectedIds.filter((id) => !current.has(id)),
    toRemove: [...current].filter((id) => !selected.has(id)),
  }
}

// Is this admin editing their own row? Used to lock self-demote / self-deactivate
// in the UI (the DB blocks it regardless via protect_profile_columns).
export function isSelf(player, currentUserId) {
  return !!player && player.id === currentUserId
}

// A squad member who counts for the team: an active, manager-approved player.
// This is the single source of truth for who appears in who's-in / no-reply /
// roster counts. Supporters (is_player=false) and unapproved/inactive players
// are excluded. Mirrors the DB's is_active_player() used by the availability RLS.
export function isSquadMember(p) {
  return !!(p && p.active && p.approved && p.is_player)
}

// Can this profile set their own availability? Same gate as isSquadMember — the
// DB enforces it via RLS, this just keeps the UI honest (view but can't act).
export function canSetAvailability(profile) {
  return isSquadMember(profile)
}

// Plain-English account state for banners + Players tags.
//   supporter — an app user who isn't a player (view-only)
//   pending   — a player awaiting the manager's sign-off (view, can't act)
//   inactive  — a removed player (soft delete)
//   active    — a signed-off, active squad player
export function accountStatus(p) {
  if (!p) return 'active'
  if (!p.is_player) return 'supporter'
  if (!p.active) return 'inactive'
  if (!p.approved) return 'pending'
  return 'active'
}
