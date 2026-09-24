// JSON-line logger for the Edge Functions (plain ESM so vitest can load it;
// Deno imports it relatively from each function's index.ts).
//
// One JSON object per line so the Supabase function logs — and any drain —
// can filter on fn / id / event. Every function emits ONE `done` summary per
// request (caller, mode, targets, tokens, sent, pruned, failed by status
// class, elapsed ms) plus a `warn`/`error` line for anything it skipped.
//
// NEVER log a push token, email, phone, name or password. `scrub()` drops any
// field whose key ENDS in one of those words as a safety net (token,
// pushToken, user_email, scorer_name…) while counts and ids such as `tokens`
// or `tokenId` pass — but the rule is: ids and counts only.

const PII_KEY = /(token|email|phone|password|secret|authorization|name)$/i

export function scrub(fields) {
  const out = {}
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (PII_KEY.test(k)) continue
    out[k] = v
  }
  return out
}

export function newRequestId() {
  try { return crypto.randomUUID() } catch { /* very old runtime */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// mkLog('send-push', req) → { id, info(event, fields), warn(), error(), elapsed() }
// `sink` is console by default; tests pass a fake.
export function mkLog(fn, req = null, sink = console) {
  const id = newRequestId()
  const started = Date.now()
  const method = req?.method ?? null
  const line = (level, event, fields) => {
    const rec = { ts: new Date().toISOString(), fn, id, level, event, ...(method ? { method } : {}), ...scrub(fields) }
    const write = level === 'error' ? sink.error : level === 'warn' ? sink.warn : sink.log
    try { write.call(sink, JSON.stringify(rec)) } catch { /* logging must never throw */ }
    return rec
  }
  return {
    id,
    elapsed: () => Date.now() - started,
    info: (event, fields) => line('info', event, fields),
    warn: (event, fields) => line('warn', event, fields),
    error: (event, fields) => line('error', event, fields),
  }
}
