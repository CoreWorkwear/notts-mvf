// Pure helpers for competitions (§1.5) — kept out of the component for testing.

export const COMPETITION_TYPES = [
  { key: 'league', label: 'League' },
  { key: 'cup', label: 'Cup' },
  { key: 'friendly_series', label: 'Friendlies' },
  { key: 'other', label: 'Other' },
]

export const competitionTypeLabel = (type) =>
  COMPETITION_TYPES.find((t) => t.key === type)?.label ?? 'Other'

export function validateCompetition({ name, squad_limit_enabled, squad_limit }) {
  if (!name?.trim()) return 'Give the competition a name.'
  if (squad_limit_enabled && !(Number(squad_limit) > 0)) return 'Set a squad size (or turn the limit off).'
  return null
}

// Normalise a competition form into a DB payload: a disabled limit forces the
// size to null (unlimited), an enabled one stores a positive integer.
export function competitionPayload(c) {
  const enabled = !!c.squad_limit_enabled
  return {
    name: c.name.trim(),
    type: c.type || 'league',
    squad_limit_enabled: enabled,
    squad_limit: enabled ? (Number(c.squad_limit) || null) : null,
    // Retire-not-delete + ordering. New competitions default active; sort_order
    // controls listing order (First Team league first, Community next, …).
    active: c.active === undefined ? true : !!c.active,
    sort_order: Number(c.sort_order) || 0,
  }
}

// Human summary of a competition's squad rule, for the admin list.
export function squadRuleSummary(c) {
  if (!c?.squad_limit_enabled) return 'No squad limit'
  return c.squad_limit ? `${c.squad_limit}-player squad` : 'Squad limit on (size not set)'
}
