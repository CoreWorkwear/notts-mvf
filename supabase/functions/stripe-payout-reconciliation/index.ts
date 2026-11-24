import { createClient } from 'npm:@supabase/supabase-js@2.119.2'
import { ConnectError, createStripeClient, stripeMode } from '../_shared/stripeConnect.js'
import { createConnectedStripeClient } from '../_shared/stripeCheckout.js'
import { runPayoutAction } from '../_shared/stripePayouts.js'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS' }
Deno.serve(async req => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)
  try {
    const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false, autoRefreshToken: false },
    })
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: auth, error: authError } = await user.auth.getUser()
    if (authError || !auth.user) return json({ error: 'Sign in to view club payouts.' }, 401)
    let body
    try { body = await req.json() } catch { return json({ error: 'Body must be JSON.' }, 400) }
    const { data: profile, error: profileError } = await admin.from('profiles').select('id,club_id,role,approved,active,is_player').eq('id', auth.user.id).single()
    if (profileError || !profile) return json({ error: 'Club payout access refused.' }, 403)
    const { data: release, error: releaseError } = await admin.from('club_payments_release').select('enabled').eq('club_id', profile.club_id).maybeSingle()
    if (releaseError) throw new Error('release_read_failed')
    const mode = Deno.env.get('STRIPE_WEBHOOK_MODE')
    const secret = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
    const store = {
      async connection(scope: any) {
        const { data, error } = await admin.from('club_stripe_connections').select('club_id,platform_account_id,livemode,stripe_account_id')
          .eq('club_id', scope.club_id).eq('platform_account_id', scope.platform_account_id).eq('livemode', scope.livemode).maybeSingle()
        if (error) throw new Error('payout_connection_read_failed')
        return data
      },
      async report(scope: any, from: string, to: string, payout: string | null) {
        const { data, error } = await user.rpc('get_stripe_payout_report', { p_platform_account_id: scope.platform_account_id,
          p_livemode: scope.livemode, p_from: from, p_to: to, p_payout_id: payout })
        if (error) throw new ConnectError('Payout is unavailable for this club account.', error.code === '42501' ? 403 : 503)
        return data
      },
      async save(scope: any, actor: string, payout: unknown, lines: unknown, complete: boolean, issues: string[]) {
        const { error } = await admin.rpc('save_stripe_payout_breakdown', { p_actor_id: actor, p_club_id: scope.club_id,
          p_platform_account_id: scope.platform_account_id, p_livemode: scope.livemode, p_payout: payout,
          p_lines: lines, p_complete: complete, p_issues: issues })
        if (error) throw new ConnectError('The payout refresh could not be saved. Previous findings are retained.', error.code === '42501' ? 403 : 503)
      },
    }
    return json(await runPayoutAction({ action: body?.action, from: body?.from, to: body?.to, payoutId: body?.payout_id,
      profile, enabled: release?.enabled === true, platformAccountId: Deno.env.get('STRIPE_PLATFORM_ACCOUNT_ID'), mode, store,
      platformStripe: async (path: string, options: any) => {
        if (stripeMode(secret) !== mode) throw new ConnectError('Stripe payout mode is not configured.')
        return createStripeClient(secret)(path, options)
      },
      connectedStripe: (account: string) => createConnectedStripeClient(secret, account),
    }))
  } catch (error) {
    return error instanceof ConnectError ? json({ error: error.message }, error.status) : json({ error: 'Payouts are temporarily unavailable. Previous findings are retained.' }, 503)
  }
})
