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

const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g
const JWT = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g
// Postgres puts the whole offending row (names, emails, phones) in the
// DETAIL of a constraint error: "Failing row contains (…)".
const FAILING_ROW = /Failing row contains \(.*\)/g
const UUID_OR_PHONE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[+(]?\d[\d\s().+-]*\d/gi
const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Mask PII inside a free-text string: failing-row dumps, JWTs, emails and
// phone-like digit runs (7+ digits, spaces / + / - / brackets allowed).
// Request ids and other uuids are left alone.
export function scrubString(str) {
  if (typeof str !== 'string') return str
  return str
    .replace(FAILING_ROW, 'Failing row contains ([redacted])')
    .replace(JWT, '[jwt]')
    .replace(EMAIL, '[email]')
    .replace(UUID_OR_PHONE, (m) => {
      if (UUID_ONLY.test(m)) return m
      return (m.match(/\d/g) ?? []).length >= 7 ? '[phone]' : m
    })
}

function scrubValue(v, depth) {
  if (typeof v === 'string') return scrubString(v)
  if (v === null || typeof v !== 'object') return v
  if (depth > 5) return '[deep]'
  if (v instanceof Error) return scrubString(String(v.message ?? v))
  if (Array.isArray(v)) return v.map((x) => scrubValue(x, depth + 1))
  return scrubObject(v, depth + 1)
}

function scrubObject(fields, depth) {
  const out = {}
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (PII_KEY.test(k)) continue
    out[k] = scrubValue(v, depth)
  }
  return out
}

export function scrub(fields) {
  return scrubObject(fields, 0)
}

// What a caller is told when something unexpected broke: no exception text,
// no database wording, just a reference to quote.
export function internalErrorBody(requestId) {
  return { error: `Something went wrong on our side. Quote this reference: ${requestId}`, requestId }
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
