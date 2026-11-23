// Pure helpers for the Players admin — kept out of the component so they're
// easy to unit-test.
import { hasKickedOff } from './format'
import { MIN_PASSWORD } from './constants'

// Required fields enforced in the UI (the DB enforces NOT NULL too).
export function validatePlayer({ first_name, last_name, email, phone }, { needPassword, password } = {}) {
  if (!first_name?.trim()) return 'First name is required.'
  if (!last_name?.trim()) return 'Surname is required.'
  if (!email?.trim()) return 'Email is required.'
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return "That email doesn't look right."
  if (!phone?.trim()) return 'Phone is required.'
  if (needPassword && (!password || password.length < MIN_PASSWORD)) return `Starter password must be at least ${MIN_PASSWORD} characters.`
  return null
}

// Work out which team_membership rows to add and which to remove, given the
// player's current team_ids and the keys ticked in the form.
//
// FAILS CLOSED on the squads list. An empty/missing `teams` means the fetch
// didn't load, NOT that the manager unticked everything — with teams=[] every
// current id looked "unticked" and a save stripped the player from every squad
// (and, post-0034, left them unable to answer a single fixture). No list, no diff.
export function diffMemberships(currentTeamIds, selectedKeys, teams) {
  if (!Array.isArray(teams) || teams.length === 0) return { toAdd: [], toRemove: [] }
  const idByKey = Object.fromEntries(teams.map((t) => [t.key, t.id]))
  const selectedIds = (selectedKeys ?? []).map((k) => idByKey[k]).filter(Boolean)
  const current = new Set(currentTeamIds ?? [])
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
//   'postponed'                           — the game is off; its date is about to change
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
  // The one reason here that is NOT a database rule: RLS would take an answer
  // for a postponed game until its old kickoff. But it would be an answer for a
  // date that is about to change (the fixture row keeps the old one until the
  // manager re-dates it), so the app does not ask. Before the kickoff check, so
  // a game called off reads "postponed", never "under way".
  if (fixture.postponed || fixture.status === 'postponed') return 'postponed'
  if (hasKickedOff(fixture.match_date, fixture.kickoff)) return 'kicked-off'
  return null
}

// Which upcoming game leads the Fixtures page. A player gets the next one THEY
// can answer: fixtures are visible club-wide but answered per squad, so "the
// club's next game" is often one a Community-only player can only watch, and
// the one-tap control belongs on his own. Nothing answerable (supporter,
// pending, or simply no game for his squad) falls back to the next game. The
// manager always sees the club's next game. `fixtures` is in kickoff order.
export function leadFixture(fixtures, blockFor, { manager = false } = {}) {
  const list = fixtures ?? []
  if (manager) return list[0] ?? null
  return list.find((f) => blockFor(f) === null) ?? list[0] ?? null
}

// The line we show in place of the In / Maybe / Out buttons. `compact` is the
// terse version for a fixture strip; the full one adds context.
export function respondBlockCopy(reason, { compact = false } = {}) {
  switch (reason) {
    case 'supporter':
      return compact ? 'Supporter' : 'Supporter · View only'
    case 'inactive':
      return compact ? 'Inactive' : 'Account inactive'
    case 'pending':
      return compact ? 'Pending approval' : 'Awaiting manager approval'
    case 'other-team':
      return null
    case 'postponed':
      return compact ? 'Postponed' : 'Postponed · Awaiting new date'
    case 'kicked-off':
      return compact ? 'Kicked off' : 'Kicked off · Availability closed'
    default:
      return compact ? '—' : 'Availability closed'
  }
}

// Plain-English account state for banners, Players tags and the holding screen.
// Order matters: a switched-off account is inactive whatever else it is; an
// account the manager hasn't signed off is pending, player OR supporter (the
// database now shows a pending account nothing club-wide); only then does a
// supporter differ from a player.
//   inactive  — a removed account (soft delete)
//   pending   — awaiting the manager's sign-off (player or supporter)
//   supporter — a signed-off app user who isn't a player (view-only)
//   active    — a signed-off, active squad player
export function accountStatus(p) {
  if (!p) return 'active'
  if (!p.active) return 'inactive'
  if (!p.approved) return 'pending'
  if (!p.is_player) return 'supporter'
  return 'active'
}

// The state that puts an account on the holding screen instead of the app:
// 'pending' | 'inactive', or null. Admins are never held (the database never
// blocks them either), and neither is a profile we haven't loaded yet.
export function holdingStatus(p) {
  if (!p || p.role === 'admin') return null
  const s = accountStatus(p)
  return s === 'pending' || s === 'inactive' ? s : null
}
