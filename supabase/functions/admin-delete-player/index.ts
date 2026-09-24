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
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { mkLog } from '../_shared/log.js'
import { validateUuid } from '../_shared/validate.js'

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
    const id = validateUuid(b?.id, 'id')
    if (!id.ok) {
      log.warn('bad_request', { caller, error: id.error, ms: log.elapsed() })
      return json({ error: id.error, requestId: log.id }, 400)
    }
    if (id.value === user.id) return json({ error: "You can't delete your own account.", requestId: log.id }, 400)

    // 1) Snapshot names, detach restrict-FK history, drop operational rows and
    //    delete the profile — atomically, club-checked, in the database.
    const { data: result, error: rpcErr } = await admin.rpc('anonymise_and_delete_profile', { target: id.value, caller_club: me.club_id })
    if (rpcErr) {
      // 42501 = another club's profile (or a non-service caller); P0002 = no such profile.
      const status = rpcErr.code === '42501' ? 403 : rpcErr.code === 'P0002' ? 404 : 400
      log.warn('anonymise_failed', { caller, target: id.value, code: rpcErr.code, message: rpcErr.message, status, ms: log.elapsed() })
      return json({ error: rpcErr.message, requestId: log.id }, status)
    }
    if (!result || (result as any).deleted !== true) {
      log.error('anonymise_unexpected', { caller, target: id.value, ms: log.elapsed() })
      return json({ error: 'the profile was not deleted', requestId: log.id }, 500)
    }

    // 2) Delete the auth login. The profile is already gone; if this fails
    //    say so plainly rather than pretend the login went with it.
    const { error: aErr } = await admin.auth.admin.deleteUser(id.value)
    if (aErr) {
      log.error('auth_delete_failed', { caller, target: id.value, status: (aErr as any)?.status ?? null, message: aErr.message, ms: log.elapsed() })
      return json({ error: `Profile removed, but the login could not be deleted: ${aErr.message}`, requestId: log.id }, 500)
    }

    log.info('done', { caller, target: id.value, ...(result as Record<string, unknown>), ms: log.elapsed() })
    return json({ ok: true, requestId: log.id, ...(result as Record<string, unknown>) })
  } catch (e) {
    log.error('unhandled', { caller, message: String((e as Error)?.message ?? e), ms: log.elapsed() })
    return json({ error: String((e as Error)?.message ?? e), requestId: log.id }, 500)
  }
})
