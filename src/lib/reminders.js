// Pure helpers for the auto availability reminders (HANDOVER post-MVP).
// The scheduling lives in the run-reminders Edge Function (fired hourly by
// pg_cron); these are the bits worth unit-testing, kept framework-free. The
// Edge Function mirrors this logic in Deno/TS.

// Hours between now and kickoff (both absolute ms). Negative once it's kicked off.
export function hoursUntil(kickoffMs, nowMs) {
  return (kickoffMs - nowMs) / 3_600_000
}

// Which configured offsets are due for a fixture right now: any unsent offset
// whose window has arrived (kickoff is within `offset` hours and hasn't passed).
// Returned ascending. The caller sends ONE reminder and records ALL of these as
// sent — so a fixture added late (already inside several windows) gets a single
// nudge, not a burst, and normal fixtures get one per offset at the right time.
export function dueOffsets({ hoursToKO, offsets, sent }) {
  if (!(hoursToKO > 0)) return [] // kicked off / passed → never remind
  const sentSet = new Set(sent ?? [])
  return (offsets ?? [])
    .filter((o) => !sentSet.has(o) && hoursToKO <= o)
    .sort((a, b) => a - b)
}

// The offsets a manager can pick, in hours, with friendly labels. Day-based:
// from a fortnight out down to the day before. Availability usually closes ~3
// days out (CUTOFF_HOURS) — the later two are the manager's discretion.
export const OFFSET_CHOICES = [
  { hours: 336, label: '2 weeks' },
  { hours: 168, label: '1 week' },
  { hours: 120, label: '5 days' },
  { hours: 96,  label: '4 days' },
  { hours: 72,  label: '3 days' },
  { hours: 48,  label: '2 days' },
  { hours: 24,  label: '1 day' },
]

// The suggested availability cut-off; later nudges are flagged as discretionary.
export const CUTOFF_HOURS = 72

export function offsetLabel(hours) {
  return OFFSET_CHOICES.find((c) => c.hours === hours)?.label ?? `${hours}h`
}
