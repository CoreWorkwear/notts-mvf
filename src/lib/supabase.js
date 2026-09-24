import { createClient } from '@supabase/supabase-js'
import { breadcrumb } from './breadcrumbs'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Fail loud in dev rather than silently making unauthenticated calls.
  throw new Error(
    'Missing Supabase env vars. Copy .env.example to .env and fill in ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  )
}

// A fetch that can't hang forever. On a cold start (esp. Android waking its radio)
// a token refresh or query could otherwise stall indefinitely and freeze the app on
// its splash. This aborts after a ceiling so the call rejects and callers recover.
export const REQUEST_TIMEOUT_MS = 20000
// Storage uploads carry a body: an 8 MB phone photo on a 3G pitch-side signal
// legitimately takes longer than the query ceiling. fetch() only resolves once
// the body is sent, so uploads get their own, much longer, ceiling.
export const UPLOAD_TIMEOUT_MS = 120000
// Anything slower than this is worth a breadcrumb: it's the tell for a flaky
// signal before the request actually fails.
export const SLOW_REQUEST_MS = 5000

function ceilingFor(label) {
  return / \/storage\/v1\//.test(label) ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS
}

// "GET /rest/v1/fixtures" — method + path only. The query string carries
// filters (occasionally an email in the dupe-guard) so it is never recorded.
export function requestLabel(input, init = {}) {
  let path = '?'
  try {
    const raw = typeof input === 'string' ? input : input?.url ?? String(input)
    path = new URL(raw, 'http://local').pathname
  } catch { /* leave '?' */ }
  const method = (init.method ?? (typeof input === 'object' && input?.method) ?? 'GET').toUpperCase()
  return `${method} ${path}`
}

export function timeoutFetch(input, init = {}) {
  const controller = new AbortController()
  const label = requestLabel(input, init)
  const ceiling = ceilingFor(label)
  const started = Date.now()
  const timer = setTimeout(() => {
    breadcrumb('fetch', `${label} timed out`, { ms: ceiling })
    controller.abort(new DOMException('Request timed out', 'TimeoutError'))
  }, ceiling)
  const upstream = init.signal // still honour a caller's own cancellation
  if (upstream) {
    if (upstream.aborted) controller.abort(upstream.reason)
    else upstream.addEventListener('abort', () => controller.abort(upstream.reason), { once: true })
  }
  return fetch(input, { ...init, signal: controller.signal })
    .then((res) => {
      const ms = Date.now() - started
      // Only the anomalies leave a crumb — a normal load would drown the trail.
      if (res.status >= 400) breadcrumb('fetch', `${label} → ${res.status}`, { ms })
      else if (ms >= SLOW_REQUEST_MS) breadcrumb('fetch', `${label} slow`, { ms })
      return res
    }, (err) => {
      if (err?.name !== 'TimeoutError') breadcrumb('fetch', `${label} failed: ${err?.name ?? 'Error'}`, { ms: Date.now() - started })
      throw err
    })
    .finally(() => clearTimeout(timer))
}

// The anon key is safe in the client — RLS enforces every rule at the DB.
export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  global: { fetch: timeoutFetch },
})
