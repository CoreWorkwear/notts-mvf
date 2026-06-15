// Supabase Edge Function: auto availability reminders.
// Fired hourly by pg_cron (net.http_post) with an x-cron-secret header — NOT a
// user JWT — so it's gated by a shared secret, not auth.
//
// Deploy:  supabase functions deploy run-reminders
// Secret:  supabase secrets set CRON_SECRET=<the same value used in the cron job>
// (config.toml sets verify_jwt=false for this function.)
//
// For each club with reminders enabled, find upcoming scheduled fixtures and,
// for any configured offset (hours-before-kickoff) whose window has arrived and
// hasn't been sent, push "you in?" to that fixture's eligible roster and record
// it in reminders_sent so it never repeats.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'jsr:@supabase/supabase-js@2'

// --- Europe/London wall-clock → absolute ms (DST-aware), mirrors lib/format ---
function londonOffsetMinutes(d: Date): number {
  // Difference between the same instant rendered as London local time and UTC.
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

  const { data: settings } = await admin.from('reminder_settings').select('club_id, enabled, offsets').eq('enabled', true)
  let remindersSent = 0
  let pushes = 0

  for (const s of settings ?? []) {
    // Upcoming, not-yet-played fixtures for this club (cheap date prefilter).
    const todayIso = new Date(now - 24 * 3_600_000).toISOString().slice(0, 10)
    const { data: fixtures } = await admin
      .from('fixtures')
      .select('id, match_date, kickoff, team_id, home_away, team:teams(key, label), opponent:opponents(name)')
      .eq('club_id', s.club_id)
      .eq('status', 'scheduled')
      .gte('match_date', todayIso)

    for (const f of fixtures ?? []) {
      const hoursToKO = (londonKickoffMs(f.match_date, f.kickoff) - now) / 3_600_000
      const { data: already } = await admin.from('reminders_sent').select('hours_before').eq('fixture_id', f.id)
      const sentOffsets = (already ?? []).map((r: any) => r.hours_before)
      const due = dueOffsets(hoursToKO, s.offsets ?? [], sentOffsets)
      if (due.length === 0) continue

      // Eligible roster: approved, active players (XL → eligible only).
      const isXL = (f as any).team?.key === 'xl'
      const { data: members } = await admin
        .from('team_memberships')
        .select('profile_id, profiles!inner(active, approved, is_player, xl_eligible)')
        .eq('team_id', f.team_id)
      const targets = (members ?? [])
        .filter((m: any) => m.profiles?.active && m.profiles?.approved && m.profiles?.is_player && (!isXL || m.profiles?.xl_eligible))
        .map((m: any) => m.profile_id)

      // Record every due offset up front so a failure mid-push can't double-send.
      const rows = due.map((o) => ({ fixture_id: f.id, hours_before: o }))
      await admin.from('reminders_sent').insert(rows)
      remindersSent += rows.length

      if (targets.length === 0) continue
      const { data: tokens } = await admin.from('push_tokens').select('id, token').in('profile_id', targets)
      const us = (f as any).team?.label ?? 'Notts MvF'
      const them = (f as any).opponent?.name ?? 'the opposition'
      const matchup = f.home_away === 'Home' ? `${us} v ${them}` : `${them} v ${us}`
      const payload = JSON.stringify({
        title: matchup,
        body: 'Coming up — are you in? Tap to set your availability.',
        fixtureId: f.id, withAvailability: true, url: '/fixtures',
      })
      await Promise.all((tokens ?? []).map(async (t: any) => {
        try { await webpush.sendNotification(JSON.parse(t.token), payload); pushes++ }
        catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) await admin.from('push_tokens').delete().eq('id', t.id) }
      }))
    }
  }

  return new Response(JSON.stringify({ remindersSent, pushes }), { headers: { 'content-type': 'application/json' } })
})
