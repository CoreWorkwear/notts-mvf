// Supabase Edge Function: auto reminders (two types, one set of offsets).
// Fired hourly by pg_cron (net.http_post) with an x-cron-secret header.
//
//   availability → eligible squad, "set your availability"
//   match        → players who said in/maybe, the match details
//
// Both fire at the configured offsets but are tracked separately (reminders_sent
// .kind), so an availability send never suppresses a match send.
//
// Deploy:  supabase functions deploy run-reminders   (config.toml verify_jwt=false)
// Secret:  supabase secrets set CRON_SECRET=<same value as the cron job>
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtDate = (iso: string) => { const [, m, d] = iso.split('-').map(Number); return `${d} ${MON[(m ?? 1) - 1]}` }

// --- Europe/London wall-clock → absolute ms (DST-aware), mirrors lib/format ---
function londonOffsetMinutes(d: Date): number {
  const asLondon = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/London' }))
  const asUtc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }))
  return (asLondon.getTime() - asUtc.getTime()) / 60_000
}
function londonKickoffMs(dateStr: string, timeStr: string): number {
  const [Y, M, D] = dateStr.split('-').map(Number)
  const [h, m] = (timeStr ?? '00:00:00').split(':').map(Number)
  const guess = Date.UTC(Y, (M ?? 1) - 1, D ?? 1, h ?? 0, m ?? 0)
  const offset = londonOffsetMinutes(new Date(guess))
  return guess - offset * 60_000
}

// Same rule as src/lib/reminders.js dueOffsets — kept in sync by the test suite.
function dueOffsets(hoursToKO: number, offsets: number[], sent: number[]): number[] {
  if (!(hoursToKO > 0)) return []
  const sentSet = new Set(sent)
  return (offsets ?? []).filter((o) => !sentSet.has(o) && hoursToKO <= o).sort((a, b) => a - b)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } })
  }

  const URL_ = Deno.env.get('SUPABASE_URL')!
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@nottsmvf.app',
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  )
  const admin = createClient(URL_, SERVICE)
  const now = Date.now()

  // Push a payload to a set of players; prunes dead subscriptions. Returns count.
  async function sendTo(profileIds: string[], payload: unknown): Promise<number> {
    if (!profileIds || profileIds.length === 0) return 0
    const { data: tokens } = await admin.from('push_tokens').select('id, token').in('profile_id', profileIds)
    const body = JSON.stringify(payload)
    let sent = 0
    await Promise.all((tokens ?? []).map(async (t: any) => {
      try { await webpush.sendNotification(JSON.parse(t.token), body); sent++ }
      catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) await admin.from('push_tokens').delete().eq('id', t.id) }
    }))
    return sent
  }

  const { data: settings } = await admin
    .from('reminder_settings')
    .select('club_id, availability_enabled, match_enabled, offsets')
    .or('availability_enabled.eq.true,match_enabled.eq.true')

  let remindersSent = 0
  let pushes = 0

  for (const s of settings ?? []) {
    const offsets: number[] = s.offsets ?? []
    const todayIso = new Date(now - 24 * 3_600_000).toISOString().slice(0, 10)
    const { data: fixtures } = await admin
      .from('fixtures')
      .select('id, match_date, kickoff, team_id, home_away, venue, team:teams(key, label), opponent:opponents(name)')
      .eq('club_id', s.club_id)
      .eq('status', 'scheduled')
      .gte('match_date', todayIso)

    for (const f of fixtures ?? []) {
      const hoursToKO = (londonKickoffMs(f.match_date, f.kickoff) - now) / 3_600_000
      if (!(hoursToKO > 0)) continue

      const { data: already } = await admin.from('reminders_sent').select('hours_before, kind').eq('fixture_id', f.id)
      const sentAvail = (already ?? []).filter((r: any) => r.kind === 'availability').map((r: any) => r.hours_before)
      const sentMatch = (already ?? []).filter((r: any) => r.kind === 'match').map((r: any) => r.hours_before)

      const us = (f as any).team?.label ?? 'Notts MvF'
      const them = (f as any).opponent?.name ?? 'the opposition'
      const matchup = f.home_away === 'Home' ? `${us} v ${them}` : `${them} v ${us}`

      // 1) Availability nudges → the eligible roster.
      if (s.availability_enabled) {
        const due = dueOffsets(hoursToKO, offsets, sentAvail)
        if (due.length) {
          await admin.from('reminders_sent').insert(due.map((o) => ({ fixture_id: f.id, hours_before: o, kind: 'availability' })))
          remindersSent += due.length
          const isXL = (f as any).team?.key === 'xl'
          const { data: members } = await admin
            .from('team_memberships')
            .select('profile_id, profiles!inner(active, approved, is_player, xl_eligible)')
            .eq('team_id', f.team_id)
          const targets = (members ?? [])
            .filter((m: any) => m.profiles?.active && m.profiles?.approved && m.profiles?.is_player && (!isXL || m.profiles?.xl_eligible))
            .map((m: any) => m.profile_id)
          pushes += await sendTo(targets, {
            title: matchup, body: 'Coming up — are you in? Tap to set your availability.',
            fixtureId: f.id, withAvailability: true, url: '/fixtures',
          })
        }
      }

      // 2) Match reminders → players who said in / maybe.
      if (s.match_enabled) {
        const due = dueOffsets(hoursToKO, offsets, sentMatch)
        if (due.length) {
          await admin.from('reminders_sent').insert(due.map((o) => ({ fixture_id: f.id, hours_before: o, kind: 'match' })))
          remindersSent += due.length
          const { data: avail } = await admin.from('availability').select('profile_id').eq('fixture_id', f.id).in('status', ['in', 'maybe'])
          const targets = (avail ?? []).map((a: any) => a.profile_id)
          const where = f.venue && f.venue !== 'TBC' ? ` at ${f.venue}` : ''
          pushes += await sendTo(targets, {
            title: matchup,
            body: `${fmtDate(f.match_date)}, ${String(f.kickoff ?? '').slice(0, 5)} KO${where}. You're down to play 👊`,
            fixtureId: f.id, withAvailability: false, url: '/fixtures',
          })
        }
      }
    }
  }

  return new Response(JSON.stringify({ remindersSent, pushes }), { headers: { 'content-type': 'application/json' } })
})
