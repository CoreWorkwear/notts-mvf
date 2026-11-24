import { createClient } from 'npm:@supabase/supabase-js@2.119.2'
import { mkLog, internalErrorBody } from '../_shared/log.js'
import { ConnectError, createStripeClient, stripeMode } from '../_shared/stripeConnect.js'
import { createConnectedStripeClient } from '../_shared/stripeCheckout.js'
import { runSavedCardsAction } from '../_shared/stripeSavedCards.js'

const cors = { 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Expose-Headers': 'x-request-id' }
Deno.serve(async req => {
  const log = mkLog('stripe-saved-cards', req)
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'x-request-id': log.id },
  })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Use POST.', requestId: log.id }, 405)
  try {
    const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: auth, error: authError } = await user.auth.getUser()
    if (authError || !auth.user) return json({ error: 'Sign in to manage saved cards.', requestId: log.id }, 401)
    let body
    try { body = await req.json() } catch { return json({ error: 'Body must be JSON.', requestId: log.id }, 400) }
    const { data: profile, error: profileError } = await admin.from('profiles')
      .select('id,club_id,approved,active,is_player').eq('id', auth.user.id).single()
    if (profileError || !profile) return json({ error: 'Saved card controls are unavailable.', requestId: log.id }, 403)
    const { data: release, error: releaseError } = await admin.from('club_payments_release').select('enabled')
      .eq('club_id', profile.club_id).maybeSingle()
    if (releaseError) throw new Error('release_read_failed')
    async function read(table: string, scope: any) {
      let query = admin.from(table).select('*').eq('club_id', scope.club_id)
        .eq('platform_account_id', scope.platform_account_id).eq('livemode', scope.livemode)
      if (table === 'player_stripe_customers') query = query.eq('profile_id', scope.profile_id)
      const { data, error } = await query.maybeSingle()
      if (error) throw new Error('saved_card_scope_read_failed')
      return data
    }
    const secret = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
    const result = await runSavedCardsAction({ body, profile, enabled: release?.enabled === true,
      mode: stripeMode(secret), stripe: createStripeClient(secret), connectedStripe: (id: string) => createConnectedStripeClient(secret, id),
      store: { connection: (s: any) => read('club_stripe_connections', s), customer: (s: any) => read('player_stripe_customers', s) }, secret })
    log.info('done', { action: body.action, ms: log.elapsed() })
    return json({ ...result, requestId: log.id })
  } catch (error) {
    // Tokens, provider bodies and card identifiers must never enter logs.
    log.error('failed', { code: error instanceof ConnectError ? 'provider_or_access' : 'internal', ms: log.elapsed() })
    return error instanceof ConnectError ? json({ error: error.message, requestId: log.id }, error.status)
      : json(internalErrorBody(log.id), 500)
  }
})
