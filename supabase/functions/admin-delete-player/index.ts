// Supabase Edge Function: admin PERMANENTLY deletes a user (service_role).
// Distinct from the active/inactive soft-delete — this removes the login + the
// profile entirely. Match history is preserved under the player's NAME: goal,
// MOTM and line-up records keep scorer_name/assist_name/motm_name/player_name
// (snapshotted from the profile where they were empty) and the profile link
// goes null.
//
// The anonymise + delete is ONE database transaction — the security-definer
// RPC anonymise_and_delete_profile (migration 0035), callable by the service
// role only. It used to be five unchecked statements followed by the delete,
// so a failure half-way could strip a player's goals of their link while
// leaving the player in place. Now it either all happens or none of it does,
// and the RPC refuses a profile from another club than the caller's.
//
// Deploy: supabase functions deploy admin-delete-player   (config.toml verify_jwt=false)
// Body: { id }  — the profile id to delete.
import { createClient } from 'npm:@supabase/supabase-js@2.119.2'
import { mkLog, internalErrorBody } from '../_shared/log.js'
import { requireActiveAdmin } from '../_shared/auth.js'
import { validateUuid } from '../_shared/validate.js'
import { decideDeleteTarget, mapDeleteRpcError, removeLoginOrBlock } from '../_shared/players.js'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'x-request-id',
}

Deno.serve(async (req) => {
  const log = mkLog('admin-delete-player', req)
  const json = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { ...cors, 'content-type': 'application/json', 'x-request-id': log.id } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { ...cors, 'x-request-id': log.id } })

  let caller: string | null = null
  try {
    const URL_ = Deno.env.get('SUPABASE_URL')!
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const userClient = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const admin = createClient(URL_, SERVICE)
    const auth = await requireActiveAdmin({
      getUser: () => userClient.auth.getUser(),
      loadProfile: (id: string) => admin.from('profiles').select('role, active, club_id').eq('id', id).single(),
    })
    if (!auth.ok) {
      if ((auth as any).user) caller = (auth as any).user.id
      log.warn(auth.event, { caller, code: auth.code, ms: log.elapsed() })
      return json({ error: auth.error, requestId: log.id }, auth.status)
    }
    const { user, me } = auth as any
    caller = user.id

    let b: any
    try { b = await req.json() } catch { return json({ error: 'body must be JSON', requestId: log.id }, 400) }
    const id = validateUuid(b?.id, 'id')
    if (!id.ok) {
      log.warn('bad_request', { caller, error: id.error, ms: log.elapsed() })
      return json({ error: id.error, requestId: log.id }, 400)
    }

    // Never delete another manager here (the RPC refuses too; this gives the
    // friendly message first). A failed read is an error, not "not an admin".
    const { data: target, error: tgtErr } = await admin.from('profiles').select('role').eq('id', id.value).maybeSingle()
    if (tgtErr) {
      log.error('target_read_failed', { caller, target: id.value, code: tgtErr.code, message: tgtErr.message, ms: log.elapsed() })
      return json(internalErrorBody(log.id), 500)
    }
    const decision = decideDeleteTarget({ callerId: user.id, targetId: id.value, targetRole: target?.role ?? null })
    if (!decision.ok) {
      log.warn('delete_refused', { caller, target: id.value, status: decision.status, ms: log.elapsed() })
      return json({ error: decision.error, requestId: log.id }, decision.status)
    }

    // 1) Snapshot names, detach restrict-FK history, drop operational rows and
    //    delete the profile — atomically, club-checked, in the database.
    const { data: result, error: rpcErr } = await admin.rpc('anonymise_and_delete_profile', { target: id.value, caller_club: me.club_id })
    if (rpcErr) {
      // 42501 = another club's profile / a manager; P0002 = no such profile.
      // Anything else is a raw database error: logged, not echoed.
      const known = mapDeleteRpcError(rpcErr)
      log.warn('anonymise_failed', { caller, target: id.value, code: rpcErr.code, message: rpcErr.message, status: known?.status ?? 500, ms: log.elapsed() })
      if (known) return json({ error: known.error, requestId: log.id }, known.status)
      return json(internalErrorBody(log.id), 500)
    }
    if (!result || (result as any).deleted !== true) {
      log.error('anonymise_unexpected', { caller, target: id.value, ms: log.elapsed() })
      return json(internalErrorBody(log.id), 500)
    }

    // 2) Delete the auth login. The profile is already gone; if this fails
    //    Retry once, then ban the login so it can't be used, and say so plainly.
    const gone = await removeLoginOrBlock({
      deleteUser: () => admin.auth.admin.deleteUser(id.value),
      banUser: () => admin.auth.admin.updateUserById(id.value, { ban_duration: '876000h' }),
    })
    if (!gone.ok) {
      log.error('auth_delete_failed', { caller, target: id.value, code: gone.code, banned: gone.banned, ms: log.elapsed() })
      return json({ error: `${gone.error} Quote this reference: ${log.id}`, requestId: log.id }, 500)
    }
    if (gone.retried) log.warn('auth_delete_retried', { caller, target: id.value })

    log.info('done', { caller, target: id.value, ...(result as Record<string, unknown>), ms: log.elapsed() })
    return json({ ok: true, requestId: log.id, ...(result as Record<string, unknown>) })
  } catch (e) {
    log.error('unhandled', { caller, message: String((e as Error)?.message ?? e), ms: log.elapsed() })
    return json(internalErrorBody(log.id), 500)
  }
})
