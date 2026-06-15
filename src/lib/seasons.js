// Pure season-admin helpers (BUILD-LIST A3).

export function validateSeason({ label, start_date, end_date } = {}) {
  if (!label?.trim()) return 'Give the season a label (e.g. 2026/27).'
  if (start_date && end_date && end_date < start_date) return 'End date must be after the start date.'
  return null
}
