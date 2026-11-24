import { createClient } from 'npm:@supabase/supabase-js@2.119.2'
import { handleStripeConnectWebhook, WebhookError } from '../_shared/stripeWebhook.js'

// This is the only payments function whose JWT verification is disabled.
// Its authority is the Connect endpoint secret and raw Stripe signature.
Deno.serve(req => handleStripeConnectWebhook(req, {
  secret: Deno.env.get('STRIPE_WEBHOOK_SECRET_CONNECT'),
  platformAccountId: Deno.env.get('STRIPE_PLATFORM_ACCOUNT_ID'),
  mode: Deno.env.get('STRIPE_WEBHOOK_MODE'),
  async settle(platformAccountId: string, event: unknown) {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await admin.rpc('process_stripe_settlement_event', {
      p_platform_account_id: platformAccountId, p_event: event,
    })
    if (error) {
      if (['22023', '22P02', '22003', '23505', '23514'].includes(error.code)) {
        throw new WebhookError('Stripe payment details could not be verified.')
      }
      throw new Error('stripe_settlement_retry_required')
    }
    if (!data?.outcome) throw new Error('stripe_settlement_result_missing')
    return data
  },
}))
