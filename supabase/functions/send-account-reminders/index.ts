import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2.119.2'
import { pushToTokens } from '../_shared/push.js'
import { mkLog, internalErrorBody } from '../_shared/log.js'
import { validateUuid } from '../_shared/validate.js'

const cors = { 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Expose-Headers': 'x-request-id' }
Deno.serve(async req => {
  const log = mkLog('send-account-reminders',req)
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'x-request-id': log.id },
  })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: auth, error: authError } = await userClient.auth.getUser()
    if (authError || !auth.user) return json({ error: 'Sign in to send reminders.' },401)
    let body
    try { body = await req.json() } catch { return json({ error: 'Body must be JSON.' },400) }
    const requestId = validateUuid(body?.request_id,'request_id')
    if (!requestId.ok) return json({ error: 'A valid reminder request is required.' },400)
    const { data: batch, error } = await userClient.rpc('create_account_reminder_batch', { p_request_id: requestId.value })
    if (error?.code === '42501') return json({ error: 'Account reminders are unavailable.' },403)
    if (error || !batch) throw new Error('reminder_batch_failed')
    const base = { targeted: batch.targeted, push_sent: batch.push_sent ?? 0, push_status: batch.push_status }
    if (base.push_status !== 'pending') return json(base)

    const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
    const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
    if (!publicKey || !privateKey) return json({ ...base, push_status: 'unavailable' })
    webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@nottsmvf.app', publicKey, privateKey)
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: claim, error: leaseError } = await admin.rpc('claim_account_reminder_push', {
      p_club_id: batch.club_id, p_request_id: requestId.value, p_actor_id: auth.user.id,
    })
    if (leaseError) throw new Error('reminder_lease_failed')
    if (!claim) return json(base)
    const payload = JSON.stringify({
      title: 'Club subs reminder', body: 'Open You to check your current balance.', url: '/you',
      tag: 'club-subs-' + requestId.value,
    })
    const topic = requestId.value!.replaceAll('-', '')
    const result = await pushToTokens(claim.tokens, payload, {
      send: (subscription: unknown, data: string) => webpush.sendNotification(subscription as any, data, { topic }),
      prune: async (id: string) => { await admin.from('push_tokens').delete().eq('id',id) },
    })
    const failed = Object.values(result.failed).reduce((sum, count) => sum + count, 0)
    const { error: completeError } = await admin.rpc('finish_account_reminder_push', {
      p_club_id: batch.club_id, p_request_id: requestId.value, p_claim_id: claim.claim_id,
      p_sent: result.sent, p_failed: failed,
    })
    if (completeError) throw new Error('reminder_finish_failed')
    return json({ targeted: base.targeted, push_sent: result.sent, push_status: failed ? 'partial' : 'sent' })
  } catch {
    log.error('account_reminder_failed')
    return json(internalErrorBody(log.id),500)
  }
})
