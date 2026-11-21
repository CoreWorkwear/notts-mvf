// Supabase Edge Function: admin creates a player's login (service_role).
// The proper replacement for the browser throwaway-signUp stopgap.
// Deploy: supabase functions deploy admin-create-player
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY injected.)
//
// Body: { email, password, first_name, last_name, phone, dob?, positions?, preferred?, teams?, is_player? }
// handle_new_user builds the profile from user_metadata and forces role=player /
// approved=false; this function then signs the account off and sets its squads.
//
// Squads are NOT built by the trigger any more (migration 0034): membership now
// decides who may set availability, so it can't come from client-controlled
// signup metadata. The trigger drops everyone into the reserves and THIS
// function then RECONCILES the squads to what the manager ticked — adding the
// ones they chose and removing the ones they didn't, including that reserves
// seed — with the service role, authorised by the admin check below, which a
// self-signup never passes.
//
// Every step after createUser is CHECKED. The login exists either way, so a
// failure past that point comes back as 200 + `warning` naming what didn't
// stick (approval, squads) rather than a "clean save" that quietly left the
// player pending and reserves-only. One JSON `done` line per request; the
// request id is returned in x-request-id. No PII is logged.
import { createClient } from 'npm:@supabase/supabase-js@2.119.2'
import { mkLog, internalErrorBody } from '../_shared/log.js'
import { requireActiveAdmin } from '../_shared/auth.js'
import { validateTeamKeys, validatePlayerBody } from '../_shared/validate.js'
import { mapCreateUserError, profileInCallerClub } from '../_shared/players.js'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'x-request-id',
}

Deno.serve(async (req) => {
  const log = mkLog('admin-create-player', req)
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
    // Keep in step with MIN_PASSWORD in src/lib/constants.js and with the
    // "Minimum password length" setting in Supabase Auth — that dashboard
    // setting is the actual control; this and the client check are UX.
    const v = validatePlayerBody(b, { requirePhone: true, minPassword: 10 })
    if (!v.ok) {
      log.warn('bad_request', { caller, error: v.error, ms: log.elapsed() })
      return json({ error: v.error, requestId: log.id }, 400)
    }
    const p = v.value
    const teamKeys = validateTeamKeys(b.teams)
    if (!teamKeys.ok) {
      log.warn('bad_request', { caller, error: teamKeys.error, ms: log.elapsed() })
      return json({ error: teamKeys.error, requestId: log.id }, 400)
    }

    const isPlayer = p.is_player
    const { data, error } = await admin.auth.admin.createUser({
      email: p.email,
      password: p.password,
      email_confirm: true,
      user_metadata: {
        first_name: p.first_name, last_name: p.last_name, phone: p.phone,
        dob: p.dob, positions: p.positions, preferred: p.preferred,
        teams: teamKeys.keys, is_player: isPlayer,
      },
    })
    if (error || !data.user?.id) {
      log.warn('create_user_failed', { caller, status: (error as any)?.status ?? null, code: (error as any)?.code ?? null, ms: log.elapsed() })
      const known = error ? mapCreateUserError(error) : null
      if (known) return json({ error: known.error, requestId: log.id }, known.status)
      return json(internalErrorBody(log.id), 500)
    }
    const newId = data.user.id

    // Belt and braces for multi-club: the new profile must land in the
    // caller's club. If it didn't, undo the login and refuse.
    const { data: made, error: madeErr } = await admin.from('profiles').select('club_id').eq('id', newId).maybeSingle()
    if (!profileInCallerClub({ made, madeErr, callerClub: me.club_id })) {
      log.error('club_mismatch', { caller, created: newId, code: madeErr?.code ?? null, readFailed: !!madeErr, ms: log.elapsed() })
      const { error: undoErr } = await admin.auth.admin.deleteUser(newId)
      if (undoErr) log.error('club_mismatch_undo_failed', { caller, created: newId, code: (undoErr as any)?.code ?? null })
      return json({ error: "That player couldn't be added to your club.", requestId: log.id }, 403)
    }
    const warnings: string[] = []

    // Manager-added → sign them off immediately (the trigger lands them pending).
    const { error: apErr } = await admin.from('profiles').update({ approved: true, is_player: isPlayer }).eq('id', newId)
    if (apErr) {
      log.error('approve_failed', { caller, created: newId, code: apErr.code, message: apErr.message })
      warnings.push("their account is still PENDING — sign them off in Players")
    }

    // Set the squads to EXACTLY what the manager ticked. Add AND remove: the
    // trigger seeds the reserves for every new account and cannot tell an
    // admin create from a self-signup (it fires on auth.users either way), so
    // a plain upsert would leave a First-Team-only signing in Community too —
    // and since 0034 membership is what lets you answer a fixture, that would
    // be the reported bug in the other direction.
    // Ticking nothing is not a statement, so the seeded reserves row stands.
    let teamsSet = 0
    const wanted = teamKeys.keys
    if (isPlayer && wanted.length) {
      // Verified above to be the caller's club.
      const clubId = me.club_id
      {
        const { data: teams, error: teamsErr } = await admin.from('teams').select('id, key').eq('club_id', clubId).in('key', wanted)
        const wantedIds = (teams ?? []).map((t: { id: string }) => t.id)
        if (teamsErr) {
          log.error('teams_read_failed', { caller, created: newId, code: teamsErr.code, message: teamsErr.message })
          warnings.push("their team(s) didn't save — set them in Players")
        } else if (wantedIds.length !== wanted.length) {
          log.warn('teams_unresolved', { caller, created: newId, requested: wanted.length, resolved: wantedIds.length })
          warnings.push("one of their team(s) wasn't recognised — check them in Players")
        }
        if (!teamsErr && wantedIds.length) {
          const { error: addErr } = await admin.from('team_memberships')
            .upsert(wantedIds.map((team_id: string) => ({ profile_id: newId, team_id })), { onConflict: 'profile_id,team_id' })
          const { error: cutErr } = await admin.from('team_memberships')
            .delete().eq('profile_id', newId)
            .not('team_id', 'in', `(${wantedIds.join(',')})`)
          if (addErr || cutErr) {
            log.error('memberships_write_failed', { caller, created: newId, code: addErr?.code ?? cutErr?.code ?? null, message: addErr?.message ?? cutErr?.message ?? null })
            warnings.push("their team(s) didn't save — set them in Players")
          } else {
            teamsSet = wantedIds.length
          }
        }
      }
    }

    const warning = warnings.length ? `Player created, but ${[...new Set(warnings)].join('; ')}.` : undefined
    log.info('done', { caller, created: newId, isPlayer, teamsRequested: wanted.length, teamsSet, warning: !!warning, ms: log.elapsed() })
    return json(warning ? { id: newId, warning, requestId: log.id } : { id: newId, requestId: log.id })
  } catch (e) {
    log.error('unhandled', { caller, message: String((e as Error)?.message ?? e), ms: log.elapsed() })
    return json(internalErrorBody(log.id), 500)
  }
})
