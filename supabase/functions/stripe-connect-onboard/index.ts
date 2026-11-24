import { createClient } from 'npm:@supabase/supabase-js@2.119.2'
import { mkLog, internalErrorBody } from '../_shared/log.js'
import { ConnectError, createStripeClient, runConnectAction, stripeMode } from '../_shared/stripeConnect.js'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'x-request-id',
}

Deno.serve(async req => {
  const log = mkLog('stripe-connect-onboard', req)
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'x-request-id': log.id },
  })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Use POST.', requestId: log.id }, 405)
  try {
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: auth, error: authError } = await userClient.auth.getUser()
    if (authError || !auth.user) return json({ error: 'Sign in to use club payments.', requestId: log.id }, 401)
    let body
    try { body = await req.json() } catch { return json({ error: 'Body must be JSON.', requestId: log.id }, 400) }
    const { data: profile, error: profileError } = await admin.from('profiles')
      .select('id,club_id,role,approved,active,is_player').eq('id', auth.user.id).single()
    if (profileError || !profile) return json({ error: 'Club payments access refused.', requestId: log.id }, 403)
    const { data: release, error: releaseError } = await admin.from('club_payments_release')
      .select('enabled').eq('club_id', profile.club_id).maybeSingle()
    if (releaseError) throw new Error('release_read_failed')
    const secret = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
    const scopeQuery = (scope: any) => admin.from('club_stripe_connections').select('*')
      .eq('club_id', scope.club_id).eq('platform_account_id', scope.platform_account_id).eq('livemode', scope.livemode)
    const store = {
      async read(scope: any) {
        const { data, error } = await scopeQuery(scope).maybeSingle()
        if (error) throw new Error('connection_read_failed')
        return data
      },
      async reserve(scope: any, actor: string) {
        const { data, error } = await admin.rpc('reserve_club_stripe_connection', {
          p_club_id: scope.club_id, p_platform_account_id: scope.platform_account_id,
          p_livemode: scope.livemode, p_actor_id: actor,
        })
        if (error || !data) throw new Error('connection_reserve_failed')
        return data
      },
      async save(row: any, accountId: string, status: any) {
        const { error } = await admin.rpc('save_club_stripe_connection', {
          p_club_id: row.club_id, p_platform_account_id: row.platform_account_id, p_livemode: row.livemode,
          p_creation_id: row.creation_id, p_account_id: accountId, p_status: status,
        })
        if (error) throw new Error('connection_save_failed')
      },
    }
    const result = await runConnectAction({ action: body?.action, profile, enabled: release?.enabled === true,
      platformAccountId: Deno.env.get('STRIPE_PLATFORM_ACCOUNT_ID'),
      mode: stripeMode(secret), stripe: createStripeClient(secret), store, appBaseUrl: Deno.env.get('APP_BASE_URL') })
    log.info('done', { action: body.action, ready: result.ready, ms: log.elapsed() })
    return json({ ...result, requestId: log.id })
  } catch (error) {
    // Never log provider bodies, authorization headers or single-use URLs.
    log.error('failed', { code: error instanceof ConnectError ? 'provider_or_access' : 'internal', ms: log.elapsed() })
    return error instanceof ConnectError ? json({ error: error.message, requestId: log.id }, error.status)
      : json(internalErrorBody(log.id), 500)
  }
})
