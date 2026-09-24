// The run-reminders decision logic (plain ESM, vitest-tested). The Edge
// Function's index.ts only wires Supabase-backed `deps` into processFixture();
// everything that decides WHAT happens lives here so it can be proven without
// Deno.
//
// Mirrors src/lib/reminders.js (dueOffsets / targets) — keep the two in step.
//
// The per-fixture contract (the bugs this replaces are in brackets):
//   1. Reckon hours-to-kickoff in Europe/London, same as the app.
//   2. Read the ledger. A read ERROR skips the fixture — it must NOT look like
//      "nothing sent yet" [was: `already = null` → every offset due → a
//      duplicate blast every hour until the read healed].
//   3. Read availability + roster BEFORE claiming anything. Either failing
//      skips the fixture, so a failed read claims nothing and, crucially, an
//      availability-read error never widens the nudge to the whole roster
//      [was: `statusById = {}` → everyone "undecided"].
//   4. The ledger INSERT is the lock. 23505 means another run owns this
//      offset → skip. Any other insert error → skip (don't send unclaimed).
//   5. Send. If NOTHING was delivered (no targets, no tokens, token read
//      failed, every push failed) give the offset back by deleting the ledger
//      rows, so the next hourly run tries again instead of the ledger claiming
//      a send that never happened [was: ledger written first, unconditionally].

import { activeRoster, statusMap } from './roster.js'

export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const fmtDate = (iso) => { const [, m, d] = String(iso).split('-').map(Number); return `${d} ${MON[(m ?? 1) - 1]}` }

// --- Europe/London wall-clock → absolute ms (DST-aware), mirrors lib/format ---
export function londonOffsetMinutes(d) {
  const asLondon = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/London' }))
  const asUtc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }))
  return (asLondon.getTime() - asUtc.getTime()) / 60_000
}
export function londonKickoffMs(dateStr, timeStr) {
  const [Y, M, D] = String(dateStr).split('-').map(Number)
  const [h, m] = String(timeStr ?? '00:00:00').split(':').map(Number)
  const guess = Date.UTC(Y, (M ?? 1) - 1, D ?? 1, h ?? 0, m ?? 0)
  const offset = londonOffsetMinutes(new Date(guess))
  return guess - offset * 60_000
}
export function hoursToKickoff(f, nowMs) {
  return (londonKickoffMs(f.match_date, f.kickoff) - nowMs) / 3_600_000
}

// Same rule as src/lib/reminders.js dueOffsets.
export function dueOffsets({ hoursToKO, offsets, sent }) {
  if (!(hoursToKO > 0)) return []
  const sentSet = new Set(sent ?? [])
  return (offsets ?? []).filter((o) => !sentSet.has(o) && hoursToKO <= o).sort((a, b) => a - b)
}

// Availability nudges chase the UNDECIDED roster: not replied, or maybe.
export function availabilityReminderTargets(rosterIds, statusById = {}) {
  return (rosterIds ?? []).filter((id) => statusById[id] !== 'in' && statusById[id] !== 'out')
}
// Match reminders go to in/maybe — intersected with the squad that plays this
// game, because availability rows outlive squad membership (and pre-0034 rows
// exist from before responding was team-scoped).
export function matchReminderTargets(statusById = {}, rosterIds = null) {
  const said = Object.keys(statusById).filter((id) => statusById[id] === 'in' || statusById[id] === 'maybe')
  if (!Array.isArray(rosterIds)) return said
  const roster = new Set(rosterIds)
  return said.filter((id) => roster.has(id))
}
export function targetsFor(kind, { roster, statusById }) {
  return kind === 'availability'
    ? availabilityReminderTargets(roster, statusById)
    : matchReminderTargets(statusById, roster)
}

// --- payloads ---------------------------------------------------------------
export function matchupTitle(f) {
  const us = f?.team?.match_name || f?.team?.label || 'Notts MvF'
  const them = f?.opponent?.name ?? 'the opposition'
  return f?.home_away === 'Home' ? `${us} v ${them}` : `${them} v ${us}`
}
export function availabilityPayload(f) {
  return { title: matchupTitle(f), body: 'Coming up — are you in? Tap to set your availability.', fixtureId: f.id, withAvailability: true, url: '/fixtures' }
}
export function matchPayload(f) {
  const where = f.venue && f.venue !== 'TBC' ? ` at ${f.venue}` : ''
  return {
    title: matchupTitle(f),
    body: `${fmtDate(f.match_date)}, ${String(f.kickoff ?? '').slice(0, 5)} KO${where}. You're down to play 👊`,
    fixtureId: f.id, withAvailability: false, url: '/fixtures',
  }
}
export function payloadFor(kind, f) {
  return kind === 'availability' ? availabilityPayload(f) : matchPayload(f)
}

// --- the ledger as a lock -------------------------------------------------
export function ledgerRows(fixtureId, kind, offsets) {
  return (offsets ?? []).map((o) => ({ fixture_id: fixtureId, hours_before: o, kind }))
}
// The reminders_sent insert result → 'claimed' | 'conflict' | 'error'.
// 23505 (unique_violation) on the (fixture, hours_before, kind) PK means a
// concurrent or earlier run already owns this offset.
export function claimOutcome(error) {
  if (!error) return 'claimed'
  if (String(error.code ?? '') === '23505') return 'conflict'
  return 'error'
}
export function splitLedger(rows) {
  const sentAvail = [], sentMatch = []
  for (const r of rows ?? []) {
    if (r.kind === 'availability') sentAvail.push(r.hours_before)
    else if (r.kind === 'match') sentMatch.push(r.hours_before)
  }
  return { sentAvail, sentMatch }
}

// Which reminder kinds are due for this fixture right now → [{ kind, offsets }].
export function planFixtureReminders({ settings, hoursToKO, sentAvail, sentMatch }) {
  const jobs = []
  if (settings?.availability_enabled) {
    const due = dueOffsets({ hoursToKO, offsets: settings.availability_offsets ?? [], sent: sentAvail })
    if (due.length) jobs.push({ kind: 'availability', offsets: due })
  }
  if (settings?.match_enabled) {
    const due = dueOffsets({ hoursToKO, offsets: settings.match_offsets ?? [], sent: sentMatch })
    if (due.length) jobs.push({ kind: 'match', offsets: due })
  }
  return jobs
}

function readFailed(res) {
  return res?.error ? { code: res.error.code ?? null, message: res.error.message ?? String(res.error) } : null
}

// One fixture, start to finish. deps:
//   nowMs                      absolute ms
//   readLedger(fixtureId)      → { data: [{hours_before, kind}], error }
//   readAvailability(fixtureId)→ { data: [{profile_id, status}], error }
//   readRoster(teamId)         → { data: [{profile_id, profiles:{active,approved,is_player}}], error }
//   claim(rows)                → { error }   (insert into reminders_sent)
//   release(rows)              → { error }   (delete those rows again)
//   send(profileIds, payload)  → { attempted, sent, pruned, failed, error? }
//   log                        mkLog() instance (optional)
// Returns a summary the caller aggregates and logs. Never throws on a
// Supabase error — every failure class is a recorded skip.
export async function processFixture(f, settings, deps) {
  const { nowMs, readLedger, readAvailability, readRoster, claim, release, send, log } = deps
  const summary = { fixtureId: f.id, skipped: null, jobs: [] }
  const skip = (reason, extra) => {
    summary.skipped = reason
    if (reason !== 'kicked_off' && reason !== 'nothing_due') log?.warn('fixture_skipped', { fixtureId: f.id, reason, ...(extra ?? {}) })
    return summary
  }

  const hoursToKO = hoursToKickoff(f, nowMs)
  if (!(hoursToKO > 0)) return skip('kicked_off')

  const ledger = await readLedger(f.id)
  if (ledger?.error) return skip('ledger_read_error', readFailed(ledger))
  const { sentAvail, sentMatch } = splitLedger(ledger?.data)
  const jobs = planFixtureReminders({ settings, hoursToKO, sentAvail, sentMatch })
  if (!jobs.length) return skip('nothing_due')

  // Both audiences derive from these two reads. Done BEFORE any claim so a
  // failed read claims nothing and widens nothing.
  const [avail, members] = await Promise.all([readAvailability(f.id), readRoster(f.team_id)])
  if (avail?.error) return skip('availability_read_error', readFailed(avail))
  if (members?.error) return skip('roster_read_error', readFailed(members))
  const statusById = statusMap(avail?.data)
  const roster = activeRoster(members?.data)

  for (const job of jobs) {
    const rows = ledgerRows(f.id, job.kind, job.offsets)
    const j = { kind: job.kind, offsets: job.offsets, outcome: null, targets: 0, attempted: 0, sent: 0, pruned: 0, failed: null }
    summary.jobs.push(j)

    const claimed = await claim(rows)
    j.outcome = claimOutcome(claimed?.error)
    if (j.outcome !== 'claimed') {
      log?.warn('claim_skipped', { fixtureId: f.id, kind: job.kind, offsets: job.offsets, outcome: j.outcome, ...(readFailed(claimed) ?? {}) })
      continue
    }

    const targets = targetsFor(job.kind, { roster, statusById })
    j.targets = targets.length
    const res = targets.length
      ? await send(targets, payloadFor(job.kind, f))
      : { attempted: 0, sent: 0, pruned: 0, failed: { '4xx': 0, '5xx': 0, other: 0 } }
    j.attempted = res?.attempted ?? 0
    j.sent = res?.sent ?? 0
    j.pruned = res?.pruned ?? 0
    j.failed = res?.failed ?? null
    if (res?.error) j.sendError = res.error

    if (j.sent === 0) {
      // Nobody was told. Hand the offset back so the next run retries once
      // there is someone (or a live token) to tell.
      const rel = await release(rows)
      j.outcome = rel?.error ? 'release_failed' : 'released'
      if (rel?.error) log?.error('release_failed', { fixtureId: f.id, kind: job.kind, offsets: job.offsets, ...readFailed(rel) })
    } else {
      j.outcome = 'sent'
    }
  }
  return summary
}

// Fold per-fixture summaries into the request-level totals for the `done` line.
export function emptyTotals() {
  return {
    fixtures: 0, skipped: 0, sent_jobs: 0, released: 0, conflicts: 0, claim_errors: 0,
    offsets_recorded: 0, targets: 0, tokens: 0, sent: 0, pruned: 0,
    failed: { '4xx': 0, '5xx': 0, other: 0 },
  }
}
export function addToTotals(t, s) {
  t.fixtures++
  if (s.skipped) t.skipped++
  for (const j of s.jobs ?? []) {
    if (j.outcome === 'sent') { t.sent_jobs++; t.offsets_recorded += j.offsets.length }
    else if (j.outcome === 'released' || j.outcome === 'release_failed') t.released++
    else if (j.outcome === 'conflict') t.conflicts++
    else if (j.outcome === 'error') t.claim_errors++
    t.targets += j.targets ?? 0
    t.tokens += j.attempted ?? 0
    t.sent += j.sent ?? 0
    t.pruned += j.pruned ?? 0
    for (const k of ['4xx', '5xx', 'other']) t.failed[k] += j.failed?.[k] ?? 0
  }
  return t
}
