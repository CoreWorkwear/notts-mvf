// Supabase Edge Function: send Web Push to players (admin-only).
// Deploy:  supabase functions deploy send-push
// Secrets: supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:you@club
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
//
// Body: { title, body, fixtureId?, withAvailability?, profileIds?, url? }
//  - profileIds given → those players (validated: a non-empty array of uuids,
//    400 otherwise — LineupBoard can hand over a null for an anonymised sub,
//    which used to blow up the uuid cast and come back as { sent: 0 }), then
//    filtered to approved, active PLAYERS in the caller's club — the same gate
//    as the fixture path;
//  - else fixtureId → that fixture's squad (approved, active players in the
//    fixture's team; the fixture must be in the caller's club);
//  - else broadcast → every active, approved account in the club (supporters
//    included — it's news, not a team-sheet).
//
// Every request logs ONE JSON `done` line (caller, mode, targets, tokens,
// sent, pruned, failed by status class, ms) and returns its id in the
// x-request-id header. Tokens and PII are never logged.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { mkLog } from '../_shared/log.js'
import { validateProfileIds, validateUuid } from '../_shared/validate.js'
import { pushToTokens } from '../_shared/push.js'
import { activeRoster } from '../_shared/roster.js'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'x-request-id',
}

Deno.serve(async (req) => {
  const log = mkLog('send-push', req)
  const json = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { ...cors, 'content-type': 'application/json', 'x-request-id': log.id } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { ...cors, 'x-request-id': log.id } })

  let caller: string | null = null
  try {
    const URL_ = Deno.env.get('SUPABASE_URL')!
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@nottsmvf.app',
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!,
    )

    // Caller must be an admin.
    const userClient = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: { user }, error: uErr } = await userClient.auth.getUser()
    if (uErr || !user) {
      log.warn('unauthorized', { ms: log.elapsed() })
      return json({ error: 'unauthorized', requestId: log.id }, 401)
    }
    caller = user.id
    const admin = createClient(URL_, SERVICE)
    // Mirror the DB's is_admin(): role AND active. A soft-removed manager
    // (Inactive, the documented removal path) must lose these powers too.
    const { data: me, error: meErr } = await admin.from('profiles').select('role, active, club_id').eq('id', user.id).single()
    if (meErr || me?.role !== 'admin' || me?.active !== true) {
      log.warn('forbidden', { caller, code: meErr?.code ?? null, ms: log.elapsed() })
      return json({ error: 'forbidden', requestId: log.id }, 403)
    }

    let b: any
    try { b = await req.json() } catch { return json({ error: 'body must be JSON', requestId: log.id }, 400) }
    const { title = 'Nottinghamshire MvF', body = '', fixtureId = null, withAvailability = false, profileIds = null, url = '/fixtures' } = b ?? {}

    const ids = validateProfileIds(profileIds)
    if (!ids.ok) {
      log.warn('bad_request', { caller, error: ids.error, ms: log.elapsed() })
      return json({ error: ids.error, requestId: log.id }, 400)
    }
    const fx = validateUuid(fixtureId, 'fixtureId', { required: false })
    if (!fx.ok) {
      log.warn('bad_request', { caller, error: fx.error, ms: log.elapsed() })
      return json({ error: fx.error, requestId: log.id }, 400)
    }

    let mode: 'profileIds' | 'fixture' | 'broadcast'
    let targets: string[]
    if (ids.ids) {
      mode = 'profileIds'
      // Same gate as the fixture path: approved, active players — and in the
      // caller's club, so an id from elsewhere is simply not a target.
      const { data: rows, error } = await admin.from('profiles').select('id')
        .in('id', ids.ids).eq('club_id', me.club_id).eq('active', true).eq('approved', true).eq('is_player', true)
      if (error) {
        log.error('targets_read_failed', { caller, mode, code: error.code, message: error.message, ms: log.elapsed() })
        return json({ error: 'could not resolve players', requestId: log.id }, 500)
      }
      targets = (rows ?? []).map((r: any) => r.id)
    } else if (fx.value) {
      mode = 'fixture'
      const { data: fixture, error: fErr } = await admin.from('fixtures').select('team_id, club_id').eq('id', fx.value).maybeSingle()
      if (fErr) {
        log.error('fixture_read_failed', { caller, mode, code: fErr.code, message: fErr.message, ms: log.elapsed() })
        return json({ error: 'could not read fixture', requestId: log.id }, 500)
      }
      if (!fixture || fixture.club_id !== me.club_id) {
        log.warn('fixture_not_found', { caller, mode, fixtureId: fx.value, ms: log.elapsed() })
        return json({ error: 'fixture not found', requestId: log.id }, 404)
      }
      const { data: members, error: mErr } = await admin
        .from('team_memberships')
        .select('profile_id, profiles!inner(active, approved, is_player)')
        .eq('team_id', fixture.team_id)
      if (mErr) {
        log.error('roster_read_failed', { caller, mode, code: mErr.code, message: mErr.message, ms: log.elapsed() })
        return json({ error: 'could not read the squad', requestId: log.id }, 500)
      }
      targets = activeRoster(members)
    } else {
      mode = 'broadcast'
      // Broadcast (news): every ACTIVE, APPROVED account in the club —
      // supporters included, but never deactivated or still-pending profiles.
      const { data: members, error } = await admin.from('profiles').select('id')
        .eq('club_id', me.club_id).eq('active', true).eq('approved', true)
      if (error) {
        log.error('targets_read_failed', { caller, mode, code: error.code, message: error.message, ms: log.elapsed() })
        return json({ error: 'could not resolve members', requestId: log.id }, 500)
      }
      targets = (members ?? []).map((m: any) => m.id)
    }

    if (!targets.length) {
      log.info('done', { caller, mode, targets: 0, tokens: 0, sent: 0, pruned: 0, failed: { '4xx': 0, '5xx': 0, other: 0 }, ms: log.elapsed() })
      return json({ sent: 0, targeted: 0, pruned: 0, requestId: log.id })
    }

    const { data: tokens, error: tErr } = await admin.from('push_tokens').select('id, token').in('profile_id', targets)
    if (tErr) {
      log.error('tokens_read_failed', { caller, mode, targets: targets.length, code: tErr.code, message: tErr.message, ms: log.elapsed() })
      return json({ error: 'could not read push subscriptions', requestId: log.id }, 500)
    }

    const payload = JSON.stringify({ title, body, fixtureId: fx.value, withAvailability, url })
    const res = await pushToTokens(tokens ?? [], payload, {
      send: (sub: unknown, data: string) => webpush.sendNotification(sub as any, data),
      prune: async (id: string) => {
        const { error: dErr } = await admin.from('push_tokens').delete().eq('id', id)
        if (dErr) log.warn('prune_failed', { tokenId: id, code: dErr.code })
      },
    })

    log.info('done', { caller, mode, targets: targets.length, tokens: res.attempted, sent: res.sent, pruned: res.pruned, failed: res.failed, ms: log.elapsed() })
    return json({ sent: res.sent, targeted: res.attempted, pruned: res.pruned, failed: res.failed, requestId: log.id })
  } catch (e) {
    log.error('unhandled', { caller, message: String((e as Error)?.message ?? e), ms: log.elapsed() })
    return json({ error: String((e as Error)?.message ?? e), requestId: log.id }, 500)
  }
})
