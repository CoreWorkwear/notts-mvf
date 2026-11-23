import { parseSubscription, classifyPushError } from './push.js'

export const TRAINING_PUSH_BATCH = 20
export const TRAINING_PUSH_CONCURRENCY = 4
export const TRAINING_PUSH_TIMEOUT_MS = 8_000

// Encrypt with the installed web-push library, but use abortable fetch for a
// wall-clock deadline. Its sendNotification timeout only limits socket idleness.
export async function sendTrainingPush(subscription, payload, { generateRequestDetails, fetch: fetch_ }) {
  const details = generateRequestDetails(subscription, payload, { TTL: 3600, urgency: 'high' })
  const response = await fetch_(details.endpoint, {
    method: details.method,
    headers: details.headers,
    body: details.body,
    redirect: 'error',
    signal: AbortSignal.timeout(TRAINING_PUSH_TIMEOUT_MS),
  })
  // We need the acceptance status, never a provider response body or endpoint
  // in logs. Release the body without waiting for it to finish streaming.
  if (response.body) void response.body.cancel().catch(() => {})
  if (!response.ok) throw { statusCode: response.status }
}

// Claim once, drain a bounded set, never retry inside a request. The database
// owns lease tokens, eligibility, uniqueness, backoff and terminal attempts.
export async function deliverTrainingPush({ claim, finish, send }) {
  const { data: rows, error } = await claim(TRAINING_PUSH_BATCH)
  if (error) throw new Error('Training push claim failed')
  const totals = { claimed: rows?.length ?? 0, sent: 0, failed: 0, finishFailed: 0 }
  let next = 0
  async function work() {
    while (next < (rows?.length ?? 0)) {
      const row = rows[next++]
      const parsed = parseSubscription(JSON.stringify(row.device_token))
      let success = false
      let failure = 'invalid_subscription'
      if (!parsed.corrupt) {
        try {
          // Training always opens its detail. No fixture answer action may be
          // attached, especially when the occurrence has been cancelled.
          await send(parsed.sub, JSON.stringify({
            title: row.title, body: row.body, tag: row.tag, url: row.url,
            kind: 'training', canReply: row.can_reply === true,
          }))
          success = true
        } catch (e) {
          const classified = classifyPushError(e)
          failure = classified.prune ? 'subscription_gone' : 'push_' + classified.klass
        }
      }
      totals[success ? 'sent' : 'failed']++
      try {
        const outcome = await finish(row.id, row.lease_token, success, success ? null : failure)
        if (outcome.error || outcome.data !== true) totals.finishFailed++
      } catch {
        totals.finishFailed++
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(TRAINING_PUSH_CONCURRENCY, totals.claimed) }, work))
  return totals
}
