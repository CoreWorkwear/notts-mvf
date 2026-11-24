import { createClient } from 'npm:@supabase/supabase-js@2.119.2'
import { mkLog, internalErrorBody } from '../_shared/log.js'
import { ConnectError, createStripeClient, stripeMode } from '../_shared/stripeConnect.js'
import { CheckoutError, createConnectedStripeClient, runCheckoutAction } from '../_shared/stripeCheckout.js'

const cors = { 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Expose-Headers': 'x-request-id' }
Deno.serve(async req => {
  const log = mkLog('stripe-checkout', req)
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
    if (authError || !auth.user) return json({ error: 'Sign in to use player payments.', requestId: log.id }, 401)
    let body
    try { body = await req.json() } catch { return json({ error: 'Body must be JSON.', requestId: log.id }, 400) }
    const { data: profile, error: profileError } = await admin.from('profiles')
      .select('id,club_id,role,approved,active,is_player').eq('id', auth.user.id).single()
    if (profileError || !profile) return json({ error: 'Player payments access refused.', requestId: log.id }, 403)
    const { data: release, error: releaseError } = await admin.from('club_payments_release').select('enabled')
      .eq('club_id', profile.club_id).maybeSingle()
    if (releaseError) throw new Error('release_read_failed')
    async function rpc(name: string, params: any) {
      const { data, error } = await admin.rpc(name, params)
      if (error?.code === '42501') throw new CheckoutError('Player payments are unavailable.', 403, 'forbidden')
      if (error?.code === '22023' || error?.code === '23505') {
        throw new CheckoutError('This payment reference could not be reused. Refresh and check the amount.', 409, 'attempt_conflict')
      }
      if (error) throw new Error('payment_storage_failed')
      return data
    }
    const store = {
      async connection(s: any) {
        const { data, error } = await admin.from('club_stripe_connections').select('*')
          .eq('club_id', s.club_id).eq('platform_account_id', s.platform_account_id).eq('livemode', s.livemode).maybeSingle()
        if (error) throw new Error('connection_read_failed')
        return data
      },
      quote: (s: any) => rpc('stripe_player_quote', { p_club_id: s.club_id, p_actor_id: s.profile_id }),
      reserve: (s: any, b: any, callbacks: any) => rpc('reserve_stripe_checkout', {
        p_attempt_id: b.attempt_id, p_club_id: s.club_id, p_actor_id: s.profile_id,
        p_platform_account_id: s.platform_account_id, p_livemode: s.livemode, p_kind: b.kind, p_amount_pence: b.amount_pence,
        p_success_url: callbacks.success_url, p_cancel_url: callbacks.cancel_url,
      }),
      async readAttempt(s: any, id: string) {
        const { data, error } = await admin.from('stripe_checkout_attempts').select('*').eq('id', id)
          .eq('club_id', s.club_id).eq('profile_id', s.profile_id).eq('platform_account_id', s.platform_account_id)
          .eq('livemode', s.livemode).maybeSingle()
        if (error) throw new Error('attempt_read_failed')
        return data
      },
      saveCustomer: (creationId: string, customerId: string) => rpc('bind_stripe_player_customer', {
        p_creation_id: creationId, p_customer_id: customerId,
      }),
      saveSession: (id: string, customerId: string, sessionId: string, url: string | null) => rpc('bind_stripe_checkout_session', {
        p_attempt_id: id, p_customer_id: customerId, p_session_id: sessionId, p_checkout_url: url,
      }),
    }
    const secret = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
    const result = await runCheckoutAction({ body, profile, enabled: release?.enabled === true,
      mode: stripeMode(secret), stripe: createStripeClient(secret), connectedStripe: (id: string) => createConnectedStripeClient(secret, id),
      store, appBaseUrl: Deno.env.get('APP_BASE_URL') })
    log.info('done', { action: body.action, ms: log.elapsed() })
    return json({ ...result, requestId: log.id })
  } catch (error) {
    log.error('failed', { code: error instanceof CheckoutError ? error.code : 'provider_or_storage', ms: log.elapsed() })
    if (error instanceof CheckoutError) return json({ error: error.message, code: error.code,
      ...(error.quote ? { quote: error.quote } : {}), requestId: log.id }, error.status)
    if (error instanceof ConnectError) return json({ error: error.message, requestId: log.id }, error.status)
    return json(internalErrorBody(log.id), 500)
  }
})
