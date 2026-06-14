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
