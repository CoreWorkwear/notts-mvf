// Supabase Edge Function: auto reminders (two types, one set of offsets).
// Fired hourly by pg_cron (net.http_post) with an x-cron-secret header.
//
//   availability → eligible squad, "set your availability"
//   match        → players who said in/maybe, the match details
//
// Both fire at the configured offsets but are tracked separately (reminders_sent
// .kind), so an availability send never suppresses a match send.
//
// This file only WIRES Supabase into the decision logic. Everything that
// decides what happens per fixture — which offsets are due, who is targeted,
// what a read error / a ledger conflict / an undelivered send means — lives in
// ../_shared/reminders.js (plain JS, vitest-tested). In short:
//   • the reminders_sent INSERT is the lock: 23505 → someone else owns it, skip
//   • a read error skips the FIXTURE (log + next), never "send to everyone"
//   • a claim that delivered to nobody is released so the next run retries
//
// Deploy:  supabase functions deploy run-reminders   (config.toml verify_jwt=false)
// Secret:  supabase secrets set CRON_SECRET=<same value as the cron job>
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { processFixture, emptyTotals, addToTotals } from '../_shared/reminders.js'
import { pushToTokens, emptySendResult } from '../_shared/push.js'
import { mkLog } from '../_shared/log.js'

Deno.serve(async (req) => {
  const log = mkLog('run-reminders', req)
  const headers = { 'content-type': 'application/json', 'x-request-id': log.id }
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'x-request-id': log.id } })
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    log.warn('unauthorized', { ms: log.elapsed() })
    return json({ error: 'unauthorized', requestId: log.id }, 401)
  }

  try {
    const URL_ = Deno.env.get('SUPABASE_URL')!
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@nottsmvf.app',
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!,
    )
    const admin = createClient(URL_, SERVICE)
    const nowMs = Date.now()

    // Push a payload to a set of players; prunes dead / corrupt subscriptions.
    // A token-read failure is reported as attempted 0 + error, which
    // processFixture treats as "nothing delivered" and releases the claim.
    async function send(profileIds: string[], payload: unknown) {
      const { data: tokens, error } = await admin.from('push_tokens').select('id, token').in('profile_id', profileIds)
      if (error) {
        log.error('tokens_read_failed', { code: error.code, message: error.message })
        return emptySendResult({ error: error.message })
      }
      return pushToTokens(tokens ?? [], JSON.stringify(payload), {
        send: (sub: unknown, body: string) => webpush.sendNotification(sub as any, body),
        prune: async (id: string) => {
          const { error: dErr } = await admin.from('push_tokens').delete().eq('id', id)
          if (dErr) log.warn('prune_failed', { tokenId: id, code: dErr.code })
        },
      })
    }

    const deps = {
      nowMs,
      log,
      readLedger: (fixtureId: string) =>
        admin.from('reminders_sent').select('hours_before, kind').eq('fixture_id', fixtureId),
      readAvailability: (fixtureId: string) =>
        admin.from('availability').select('profile_id, status').eq('fixture_id', fixtureId),
      readRoster: (teamId: string) =>
        admin.from('team_memberships').select('profile_id, profiles!inner(active, approved, is_player)').eq('team_id', teamId),
      claim: (rows: { fixture_id: string; hours_before: number; kind: string }[]) =>
        admin.from('reminders_sent').insert(rows),
      release: (rows: { fixture_id: string; hours_before: number; kind: string }[]) =>
        admin.from('reminders_sent').delete()
          .eq('fixture_id', rows[0].fixture_id)
          .eq('kind', rows[0].kind)
          .in('hours_before', rows.map((r) => r.hours_before)),
      send,
    }

    const { data: settings, error: sErr } = await admin
      .from('reminder_settings')
      .select('club_id, availability_enabled, match_enabled, availability_offsets, match_offsets')
      .or('availability_enabled.eq.true,match_enabled.eq.true')
    if (sErr) {
      log.error('settings_read_failed', { code: sErr.code, message: sErr.message, ms: log.elapsed() })
      return json({ error: 'could not read reminder settings', requestId: log.id }, 500)
    }

    const totals = emptyTotals()
    let clubs = 0
    let clubsFailed = 0
    const todayIso = new Date(nowMs - 24 * 3_600_000).toISOString().slice(0, 10)

    for (const s of settings ?? []) {
      clubs++
      const { data: fixtures, error: fErr } = await admin
        .from('fixtures')
        .select('id, match_date, kickoff, team_id, home_away, venue, team:teams(key, label, match_name), opponent:opponents(name)')
        .eq('club_id', s.club_id)
        .eq('status', 'scheduled')
        .gte('match_date', todayIso)
      if (fErr) {
        clubsFailed++
        log.error('fixtures_read_failed', { clubId: s.club_id, code: fErr.code, message: fErr.message })
        continue
      }
      for (const f of fixtures ?? []) {
        const summary = await processFixture(f as any, s, deps)
        addToTotals(totals, summary)
      }
    }

    log.info('done', { clubs, clubsFailed, ...totals, ms: log.elapsed() })
    // remindersSent / pushes kept for anyone reading the old response shape.
    return json({ requestId: log.id, remindersSent: totals.offsets_recorded, pushes: totals.sent, clubs, clubsFailed, ...totals })
  } catch (e) {
    log.error('unhandled', { message: String((e as Error)?.message ?? e), ms: log.elapsed() })
    return json({ error: String((e as Error)?.message ?? e), requestId: log.id }, 500)
  }
})
