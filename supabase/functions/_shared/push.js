// Web Push delivery bookkeeping (plain ESM, vitest-tested). The actual
// `webpush.sendNotification` and the `push_tokens` delete are injected, so the
// prune / retry decisions can be tested without Deno or a push service.
//
// Rules:
//   • 404 / 410 from the push service → the subscription is gone → PRUNE.
//   • a token that is not valid JSON (or has no endpoint) can never be sent to
//     → PRUNE, rather than throwing on JSON.parse every hour forever.
//   • other 4xx (401/403 = VAPID misconfig, 413, 429) and 5xx → keep the
//     token, count the failure by class so the summary line shows it.

export function parseSubscription(token) {
  try {
    const sub = JSON.parse(token)
    if (!sub || typeof sub !== 'object' || typeof sub.endpoint !== 'string' || !sub.endpoint) return { corrupt: true }
    return { sub }
  } catch {
    return { corrupt: true }
  }
}

export function classifyPushError(e) {
  const status = Number(e?.statusCode ?? e?.status)
  if (status === 404 || status === 410) return { prune: true, klass: 'gone' }
  if (status >= 400 && status < 500) return { prune: false, klass: '4xx' }
  if (status >= 500) return { prune: false, klass: '5xx' }
  return { prune: false, klass: 'other' }
}

export function emptySendResult(extra = {}) {
  return { attempted: 0, sent: 0, pruned: 0, failed: { '4xx': 0, '5xx': 0, other: 0 }, ...extra }
}

// tokens: [{ id, token }] rows from push_tokens. payload: the JSON string body.
// deps.send(subscription, payload) → resolves on delivery, rejects with a
// web-push error ({ statusCode }) otherwise. deps.prune(id) removes the row.
export async function pushToTokens(tokens, payload, { send, prune }) {
  const out = emptySendResult({ attempted: (tokens ?? []).length })
  const dropToken = async (id) => {
    out.pruned++
    try { await prune(id) } catch { /* a failed prune is retried next run */ }
  }
  await Promise.all((tokens ?? []).map(async (t) => {
    const parsed = parseSubscription(t.token)
    if (parsed.corrupt) { await dropToken(t.id); return }
    try {
      await send(parsed.sub, payload)
      out.sent++
    } catch (e) {
      const c = classifyPushError(e)
      if (c.prune) await dropToken(t.id)
      else out.failed[c.klass === '4xx' || c.klass === '5xx' ? c.klass : 'other']++
    }
  }))
  return out
}
