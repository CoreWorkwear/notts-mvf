// Private, minutely pg_cron worker. The in-app notice is already durable;
// optional device delivery never depends on a browser being open.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2.119.2'
import { timingSafeEqualStrings } from '../_shared/auth.js'
import { mkLog, internalErrorBody } from '../_shared/log.js'
import { deliverTrainingPush, sendTrainingPush } from '../_shared/trainingPush.js'

Deno.serve(async (req) => {
  const log = mkLog('run-training-push', req)
  const headers = { 'content-type': 'application/json', 'x-request-id': log.id }
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers })
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || !(await timingSafeEqualStrings(req.headers.get('x-cron-secret') ?? '', secret))) {
    return json({ error: 'unauthorized', requestId: log.id }, 401)
  }
  if (req.method !== 'POST') return json({ error: 'method not allowed', requestId: log.id }, 405)

  try {
    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@nottsmvf.app',
      Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!,
    )
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(5_000) }) },
    })
    const totals = await deliverTrainingPush({
      claim: (limit: number) => admin.rpc('training_push_claim', { p_limit: limit }),
      finish: (id: string, lease: string, success: boolean, error: string | null) =>
        admin.rpc('training_push_finish', { p_id: id, p_lease: lease, p_success: success, p_error: error }),
      send: (sub: unknown, payload: string) => sendTrainingPush(sub, payload, {
        generateRequestDetails: (subscription: any, body: string, options: any) => webpush.generateRequestDetails(subscription, body, options),
        fetch,
      }),
    })
    log.info('done', { ...totals, ms: log.elapsed() })
    return json({ requestId: log.id, ...totals })
  } catch {
    // Encryption/provider errors can contain subscription URLs and key details.
    log.error('worker_failed', { ms: log.elapsed() })
    return json(internalErrorBody(log.id), 500)
  }
})
