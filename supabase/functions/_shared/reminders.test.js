import { describe, test, expect, vi } from 'vitest'
import {
  londonKickoffMs, hoursToKickoff, dueOffsets, planFixtureReminders, claimOutcome, ledgerRows,
  splitLedger, targetsFor, matchupTitle, matchPayload, availabilityPayload, processFixture,
  emptyTotals, addToTotals,
} from './reminders.js'

// ---------------------------------------------------------------------------
// London-time reckoning — must agree with the TS it replaces and lib/format.
// ---------------------------------------------------------------------------
describe('londonKickoffMs — Europe/London wall clock, GMT/BST aware', () => {
  test('a winter kickoff is GMT (= UTC)', () => {
    expect(londonKickoffMs('2026-01-11', '13:00:00')).toBe(Date.UTC(2026, 0, 11, 13, 0))
  })
  test('a summer kickoff is BST (UTC+1), so the instant is an hour EARLIER in UTC', () => {
    expect(londonKickoffMs('2026-06-14', '11:00:00')).toBe(Date.UTC(2026, 5, 14, 10, 0))
  })
  test('hoursToKickoff is positive before and negative after', () => {
    const f = { match_date: '2026-01-11', kickoff: '13:00:00' }
    expect(hoursToKickoff(f, Date.UTC(2026, 0, 11, 10, 0))).toBe(3)
    expect(hoursToKickoff(f, Date.UTC(2026, 0, 11, 15, 0))).toBe(-2)
  })
})

describe('dueOffsets — same rule as src/lib/reminders.js', () => {
  test('unsent offsets whose window has arrived, ascending; never after kickoff', () => {
    expect(dueOffsets({ hoursToKO: 10, offsets: [48, 24], sent: [] })).toEqual([24, 48])
    expect(dueOffsets({ hoursToKO: 23, offsets: [48, 24], sent: [48] })).toEqual([24])
    expect(dueOffsets({ hoursToKO: 0, offsets: [48, 24], sent: [] })).toEqual([])
    expect(dueOffsets({ hoursToKO: 10 })).toEqual([])
  })
})

describe('planFixtureReminders — which kinds are due', () => {
  const settings = { availability_enabled: true, match_enabled: true, availability_offsets: [72, 24], match_offsets: [24] }
  test('each enabled kind plans only its own unsent offsets', () => {
    expect(planFixtureReminders({ settings, hoursToKO: 20, sentAvail: [72], sentMatch: [] }))
      .toEqual([{ kind: 'availability', offsets: [24] }, { kind: 'match', offsets: [24] }])
  })
  test('a disabled kind is never planned, and nothing due → no jobs', () => {
    expect(planFixtureReminders({ settings: { ...settings, match_enabled: false }, hoursToKO: 20, sentAvail: [], sentMatch: [] }))
      .toEqual([{ kind: 'availability', offsets: [24, 72] }])
    expect(planFixtureReminders({ settings, hoursToKO: 100, sentAvail: [], sentMatch: [] })).toEqual([])
  })
})

describe('the ledger as a lock', () => {
  test('claimOutcome: no error → claimed; 23505 → conflict; anything else → error', () => {
    expect(claimOutcome(null)).toBe('claimed')
    expect(claimOutcome({ code: '23505', message: 'duplicate key' })).toBe('conflict')
    expect(claimOutcome({ code: '57P01', message: 'terminating connection' })).toBe('error')
  })
  test('ledgerRows / splitLedger round-trip by kind', () => {
    const rows = [...ledgerRows('f1', 'availability', [72, 24]), ...ledgerRows('f1', 'match', [24])]
    expect(rows[0]).toEqual({ fixture_id: 'f1', hours_before: 72, kind: 'availability' })
    expect(splitLedger(rows)).toEqual({ sentAvail: [72, 24], sentMatch: [24] })
  })
})

describe('targets + payloads', () => {
  const f = { id: 'f1', match_date: '2026-03-08', kickoff: '13:00:00', home_away: 'Away', venue: 'Forest Rec 3G', team: { label: 'First Team', match_name: 'Notts MvF XL' }, opponent: { name: 'Carlton Town' } }
  test('availability → undecided roster; match → in/maybe within the roster', () => {
    const roster = ['a', 'b', 'c', 'outsider-free']
    const statusById = { a: 'in', b: 'maybe', c: 'out', outsider: 'in' }
    expect(targetsFor('availability', { roster, statusById }).sort()).toEqual(['b', 'outsider-free'])
    expect(targetsFor('match', { roster, statusById }).sort()).toEqual(['a', 'b'])
  })
  test('copy is unchanged from the function it replaces', () => {
    expect(matchupTitle(f)).toBe('Carlton Town v Notts MvF XL')
    expect(availabilityPayload(f)).toEqual({ title: 'Carlton Town v Notts MvF XL', body: 'Coming up — are you in? Tap to set your availability.', fixtureId: 'f1', withAvailability: true, url: '/fixtures' })
    expect(matchPayload(f).body).toBe("8 Mar, 13:00 KO at Forest Rec 3G. You're down to play 👊")
    expect(matchPayload({ ...f, venue: 'TBC' }).body).toBe("8 Mar, 13:00 KO. You're down to play 👊")
  })
})

// ---------------------------------------------------------------------------
// processFixture — the per-fixture flow with every dep faked.
// ---------------------------------------------------------------------------
const NOW = Date.UTC(2026, 0, 10, 13, 0)                       // 24h before the fixture below
const FIX = { id: 'f1', team_id: 't1', match_date: '2026-01-11', kickoff: '13:00:00', home_away: 'Home', venue: 'Forest Rec 3G', team: { label: 'First Team' }, opponent: { name: 'Carlton Town' } }
const SETTINGS = { availability_enabled: true, match_enabled: true, availability_offsets: [72, 24], match_offsets: [24] }
const ROSTER = [
  { profile_id: 'p1', profiles: { active: true, approved: true, is_player: true } },
  { profile_id: 'p2', profiles: { active: true, approved: true, is_player: true } },
  { profile_id: 'p3', profiles: { active: true, approved: true, is_player: true } },
  { profile_id: 'pending', profiles: { active: true, approved: false, is_player: true } },
]
const AVAIL = [{ profile_id: 'p1', status: 'in' }, { profile_id: 'p2', status: 'maybe' }, { profile_id: 'outsider', status: 'in' }]

function deps(over = {}) {
  const d = {
    nowMs: NOW,
    readLedger: vi.fn(async () => ({ data: [{ hours_before: 72, kind: 'availability' }], error: null })),
    readAvailability: vi.fn(async () => ({ data: AVAIL, error: null })),
    readRoster: vi.fn(async () => ({ data: ROSTER, error: null })),
    claim: vi.fn(async () => ({ error: null })),
    release: vi.fn(async () => ({ error: null })),
    send: vi.fn(async (ids) => ({ attempted: ids.length, sent: ids.length, pruned: 0, failed: { '4xx': 0, '5xx': 0, other: 0 } })),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...over,
  }
  return d
}

describe('processFixture — the happy path', () => {
  test('claims each due kind, sends to the right audience, records it as sent', async () => {
    const d = deps()
    const s = await processFixture(FIX, SETTINGS, d)
    expect(s.skipped).toBeNull()
    expect(s.jobs.map((j) => [j.kind, j.offsets, j.outcome])).toEqual([
      ['availability', [24], 'sent'],
      ['match', [24], 'sent'],
    ])
    // availability → undecided in the roster (p2 maybe, p3 no reply; pending excluded)
    expect(d.send.mock.calls[0][0].sort()).toEqual(['p2', 'p3'])
    expect(d.send.mock.calls[0][1].withAvailability).toBe(true)
    // match → in/maybe AND in the roster (outsider dropped)
    expect(d.send.mock.calls[1][0].sort()).toEqual(['p1', 'p2'])
    expect(d.claim).toHaveBeenCalledTimes(2)
    expect(d.claim.mock.calls[0][0]).toEqual([{ fixture_id: 'f1', hours_before: 24, kind: 'availability' }])
    expect(d.release).not.toHaveBeenCalled()
  })

  test('a kicked-off fixture and one with nothing due are quiet skips (no reads beyond the ledger, no log noise)', async () => {
    const d = deps({ nowMs: Date.UTC(2026, 0, 11, 14, 0) })
    expect((await processFixture(FIX, SETTINGS, d)).skipped).toBe('kicked_off')
    expect(d.readLedger).not.toHaveBeenCalled()
    const d2 = deps({ nowMs: Date.UTC(2025, 11, 1) })
    expect((await processFixture(FIX, SETTINGS, d2)).skipped).toBe('nothing_due')
    expect(d2.readAvailability).not.toHaveBeenCalled()
    expect(d2.log.warn).not.toHaveBeenCalled()
  })
})

// Finding A — the three failure modes the old function got wrong.
describe('processFixture — a ledger PK conflict suppresses the send', () => {
  test('23505 on the claim → job outcome conflict, nothing sent, nothing released', async () => {
    const d = deps({ claim: vi.fn(async () => ({ error: { code: '23505', message: 'duplicate key value violates unique constraint "reminders_sent_pkey"' } })) })
    const s = await processFixture(FIX, SETTINGS, d)
    expect(s.jobs.map((j) => j.outcome)).toEqual(['conflict', 'conflict'])
    expect(d.send).not.toHaveBeenCalled()
    expect(d.release).not.toHaveBeenCalled()
    expect(d.log.warn).toHaveBeenCalledWith('claim_skipped', expect.objectContaining({ outcome: 'conflict', kind: 'availability' }))
  })
  test('any other claim error also refuses to send unclaimed', async () => {
    const d = deps({ claim: vi.fn(async () => ({ error: { code: '57P01', message: 'terminating connection' } })) })
    const s = await processFixture(FIX, SETTINGS, d)
    expect(s.jobs.map((j) => j.outcome)).toEqual(['error', 'error'])
    expect(d.send).not.toHaveBeenCalled()
  })
})

describe('processFixture — a read error yields "skip fixture", never "send to all"', () => {
  test('ledger read error: skip, no claim, no send (old code: already=null → every offset "unsent" → duplicate blast)', async () => {
    const d = deps({ readLedger: vi.fn(async () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } })) })
    const s = await processFixture(FIX, SETTINGS, d)
    expect(s.skipped).toBe('ledger_read_error')
    expect(s.jobs).toEqual([])
    expect(d.claim).not.toHaveBeenCalled()
    expect(d.send).not.toHaveBeenCalled()
    expect(d.log.warn).toHaveBeenCalledWith('fixture_skipped', expect.objectContaining({ fixtureId: 'f1', reason: 'ledger_read_error', code: '57014' }))
  })
  test('availability read error: skip, no claim, no send (old code: statusById={} → the WHOLE roster nudged)', async () => {
    const d = deps({ readAvailability: vi.fn(async () => ({ data: null, error: { code: 'PGRST000', message: 'connection refused' } })) })
    const s = await processFixture(FIX, SETTINGS, d)
    expect(s.skipped).toBe('availability_read_error')
    expect(d.claim).not.toHaveBeenCalled()
    expect(d.send).not.toHaveBeenCalled()
  })
  test('roster read error: skip, no claim — the ledger never records an offset nobody was sent (old code: ledger written BEFORE the roster read)', async () => {
    const d = deps({ readRoster: vi.fn(async () => ({ data: null, error: { code: '08006', message: 'connection failure' } })) })
    const s = await processFixture(FIX, SETTINGS, d)
    expect(s.skipped).toBe('roster_read_error')
    expect(d.claim).not.toHaveBeenCalled()
    expect(d.send).not.toHaveBeenCalled()
  })
})

describe('processFixture — a claim that delivered nothing is given back', () => {
  test('no tokens at all (attempted 0) → the ledger rows are deleted so the next run retries', async () => {
    const d = deps({ send: vi.fn(async () => ({ attempted: 0, sent: 0, pruned: 0, failed: { '4xx': 0, '5xx': 0, other: 0 } })) })
    const s = await processFixture(FIX, SETTINGS, d)
    expect(s.jobs.map((j) => j.outcome)).toEqual(['released', 'released'])
    expect(d.release).toHaveBeenCalledTimes(2)
    expect(d.release.mock.calls[0][0]).toEqual([{ fixture_id: 'f1', hours_before: 24, kind: 'availability' }])
  })
  test('a token-read error inside send (error, attempted 0) → released, and the error is on the job', async () => {
    const d = deps({ send: vi.fn(async () => ({ attempted: 0, sent: 0, pruned: 0, failed: { '4xx': 0, '5xx': 0, other: 0 }, error: 'boom' })) })
    const s = await processFixture(FIX, SETTINGS, d)
    expect(s.jobs[0]).toMatchObject({ outcome: 'released', sendError: 'boom' })
  })
  test('nobody to tell (no targets) → send never called, offset released', async () => {
    const everyoneDecided = [{ profile_id: 'p1', status: 'in' }, { profile_id: 'p2', status: 'out' }, { profile_id: 'p3', status: 'out' }]
    const d = deps({ readAvailability: vi.fn(async () => ({ data: everyoneDecided, error: null })) })
    const s = await processFixture(FIX, { ...SETTINGS, match_enabled: false }, d)
    expect(d.send).not.toHaveBeenCalled()
    expect(s.jobs[0].outcome).toBe('released')
  })
  test('a partial delivery keeps the claim (sent > 0)', async () => {
    const d = deps({ send: vi.fn(async (ids) => ({ attempted: ids.length, sent: 1, pruned: 0, failed: { '4xx': 0, '5xx': ids.length - 1, other: 0 } })) })
    const s = await processFixture(FIX, SETTINGS, d)
    expect(s.jobs.map((j) => j.outcome)).toEqual(['sent', 'sent'])
    expect(d.release).not.toHaveBeenCalled()
  })
  test('a failed release is logged as an error, not thrown', async () => {
    const d = deps({
      send: vi.fn(async () => ({ attempted: 0, sent: 0, pruned: 0, failed: { '4xx': 0, '5xx': 0, other: 0 } })),
      release: vi.fn(async () => ({ error: { code: '42501', message: 'permission denied' } })),
    })
    const s = await processFixture(FIX, SETTINGS, d)
    expect(s.jobs[0].outcome).toBe('release_failed')
    expect(d.log.error).toHaveBeenCalledWith('release_failed', expect.objectContaining({ code: '42501' }))
  })
})

describe('addToTotals — the numbers on the done line', () => {
  test('folds job outcomes and counts', () => {
    const t = emptyTotals()
    addToTotals(t, { skipped: 'ledger_read_error', jobs: [] })
    addToTotals(t, { skipped: null, jobs: [
      { kind: 'availability', offsets: [24, 72], outcome: 'sent', targets: 5, attempted: 4, sent: 3, pruned: 1, failed: { '4xx': 0, '5xx': 0, other: 0 } },
      { kind: 'match', offsets: [24], outcome: 'released', targets: 2, attempted: 0, sent: 0, pruned: 0, failed: { '4xx': 0, '5xx': 0, other: 0 } },
      { kind: 'match', offsets: [24], outcome: 'conflict', targets: 0, attempted: 0, sent: 0, pruned: 0, failed: null },
    ] })
    expect(t).toMatchObject({ fixtures: 2, skipped: 1, sent_jobs: 1, released: 1, conflicts: 1, offsets_recorded: 2, targets: 7, tokens: 4, sent: 3, pruned: 1 })
  })
})
