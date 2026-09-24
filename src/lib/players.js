// Pure helpers for the Players admin — kept out of the component so they're
// easy to unit-test.
import { hasKickedOff } from './format'

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

// The squad ids out of a team_memberships fetch (rows embedding profiles).
// Anything that buckets availability rows should gate on one of these rather
// than trusting the row: a row outlives the squad place that justified it, and
// pre-0034 rows exist against the wrong team entirely. Same reasoning as
// matchReminderTargets in reminders.js.
export function squadIds(memberships) {
  const ids = new Set()
  for (const m of memberships ?? []) {
    if (isSquadMember(m?.profiles)) ids.add(m.profiles.id)
  }
  return ids
}

// Same, keyed by team_id, for a fetch that spans every team.
export function squadIdsByTeam(memberships) {
  const byTeam = {}
  for (const m of memberships ?? []) {
    if (!isSquadMember(m?.profiles)) continue
    if (!byTeam[m.team_id]) byTeam[m.team_id] = new Set()
    byTeam[m.team_id].add(m.profiles.id)
  }
  return byTeam
}

// Can this profile set their own availability? Same gate as isSquadMember — the
// DB enforces it via RLS, this just keeps the UI honest (view but can't act).
export function canSetAvailability(profile) {
  return isSquadMember(profile)
}

// Why this player can't answer THIS fixture — or null when they can.
// Mirrors the DB gate exactly (availability_insert / availability_update via
// can_respond_to_fixture + fixture_open_for_responses + is_active_player,
// migration 0034); this just keeps the UI honest so nobody taps a button the
// database is only going to refuse.
//
//   'supporter' | 'pending' | 'inactive'  — account-level, same as accountStatus
//   'other-team'                          — not in the squad that plays this game
//   'kicked-off'                          — the game has started; answers are shut
//   'unknown'                             — we can't tell yet
//
// FAILS CLOSED. A missing profile, a fixture with no resolvable team, or a
// squad list we haven't loaded yet all block: hiding the control for a moment
// is right, showing one whose write is doomed is not.
export function respondBlock(profile, myTeamIds, fixture) {
  if (!profile) return 'unknown'
  if (!canSetAvailability(profile)) return accountStatus(profile)
  if (!fixture?.team_id || !fixture?.match_date || !Array.isArray(myTeamIds)) return 'unknown'
  if (!myTeamIds.includes(fixture.team_id)) return 'other-team'
  if (hasKickedOff(fixture.match_date, fixture.kickoff)) return 'kicked-off'
  return null
}

// The line we show in place of the In / Maybe / Out buttons. `compact` is the
// terse version for a fixture strip; the full one gets a sentence.
export function respondBlockCopy(reason, fixture, { compact = false } = {}) {
  const squad = fixture?.team?.label ?? 'that'
  switch (reason) {
    case 'supporter':
      return compact ? 'Supporter' : "You're set up as a supporter — you can follow the fixtures and results, but you won't be picked for the squad."
    case 'inactive':
      return compact ? 'Inactive' : 'Your account is inactive. Have a word with the manager to get back in the squad.'
    case 'pending':
      return compact ? 'Not signed off yet' : 'Availability opens once the manager signs you off.'
    case 'other-team':
      return compact ? `${squad} squad only` : `${squad} squad only — have a word with the manager if you fancy stepping up.`
    case 'kicked-off':
      return compact ? 'Kicked off' : "That one's under way — availability shut at kickoff."
    default:
      return compact ? '—' : 'Availability is closed for this one.'
  }
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
