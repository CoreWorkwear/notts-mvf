import { supabase } from './supabase'
import { breadcrumb, getBreadcrumbs, sinceLoadMs } from './breadcrumbs'
import { describeError, isNetworkError } from './errors'

// Self-hosted client error logging. logError() is best-effort: it must NEVER
// throw (or it could loop), it's rate-limited per session so a misbehaving
// component can't flood the table, and a repeat of the same error inside a
// minute is collapsed. Every row carries enough to diagnose it from the
// Diagnostics screen alone: the normalised error (name/code/status/hint), the
// build it came from, the route, online/visibility state, and the tail of the
// breadcrumb trail. buildErrorRow / enrichContext / scrub are pure for tests.

// At most MAX_PER_SESSION rows per rolling BUDGET_WINDOW_MS — a flood is
// capped, but an installed PWA left open for days keeps reporting (a lifetime
// cap went silent after 30 events and never came back).
export const MAX_PER_SESSION = 30
export const BUDGET_WINDOW_MS = 60 * 60 * 1000
export const DEDUPE_WINDOW_MS = 60_000
export const MAX_QUEUED = 10
export const BREADCRUMBS_PER_ROW = 15
// Stamped by vite.config.js (`<pkg version>+<git sha>`); 'dev' under a bare runtime.
export const BUILD = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'

const sentAt = []        // timestamps of rows sent inside the budget window
const recent = new Map() // `${kind}|${message}` → last logged at (ms)
const queue = []         // rows we couldn't deliver (offline / dropped) — retried on 'online'

// --- PII guard ----------------------------------------------------------------
// PII lives in profile_private and must never land in client_errors. Keys that
// look sensitive are redacted wholesale; JWTs and email addresses are masked
// wherever they appear in strings (Supabase error text sometimes echoes them).
const SENSITIVE_KEY = /pass|token|secret|authori|cookie|email|phone|\bdob\b|ec_name|ec_phone|apikey|api_key|address|postcode/i
const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g
const EMAIL_RE = /[^\s@"'<>()]+@[^\s@"'<>()]+\.[^\s@"'<>()]+/g

export function scrub(value, depth = 0, seen = new WeakSet()) {
  if (depth > 6) return '[deep]'
  if (typeof value === 'string') return value.replace(JWT_RE, '[jwt]').replace(EMAIL_RE, '[email]')
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[circular]'
    seen.add(value)
    return value.slice(0, 50).map((v) => scrub(v, depth + 1, seen))
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) return '[circular]'
    seen.add(value)
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : scrub(v, depth + 1, seen)
    return out
  }
  return value
}

// A URL gets the same masking as a message, but percent-DECODED first: an
// email in a query string arrives as `alan%40example.com`, which EMAIL_RE
// cannot see. Decoding costs nothing (an error-log URL is for reading, not
// for replaying) and it is the only form PII actually turns up in here.
export function scrubUrl(url) {
  const raw = String(url ?? '')
  let decoded = raw
  try { decoded = decodeURIComponent(raw) } catch { /* malformed %-escape — mask the raw form */ }
  return scrub(decoded)
}

// Serialise context defensively — scrub, then drop anything circular/unserialisable.
function safeContext(context) {
  if (!context) return null
  try { return JSON.parse(JSON.stringify(scrub(context))) } catch { return { note: 'context unserialisable' } }
}

export function buildErrorRow({ kind, message, context, profileId = null, clubId = null, url = null, userAgent = null }) {
  return {
    kind: String(kind || 'error').slice(0, 40),
    message: scrub(String(message ?? 'Unknown error')).slice(0, 1000),
    context: safeContext(context),
    // Scrubbed like the message: `url` carries location.search, and a query
    // string is the one place a stray email or token can turn up in a route
    // (the admin duplicate-email lookup, a pasted recovery link). client_errors
    // is admin-readable, so PII must not reach it by that back door either.
    url: url ? scrubUrl(url).slice(0, 500) : null,
    user_agent: userAgent ? String(userAgent).slice(0, 500) : null,
    profile_id: profileId,
    club_id: clubId,
  }
}

// What every row gets on top of the caller's context: the normalised error
// (when the caller passed the error itself, not just its message), the build,
// where they were, whether they were online, and the breadcrumb tail.
export function enrichContext(context, err) {
  const d = err !== undefined && err !== null ? describeError(err) : null
  const out = { ...(context ?? {}) }
  if (d) {
    out.errName = d.name
    if (d.code != null) out.code = d.code
    if (d.status != null) out.status = d.status
    if (d.details) out.details = d.details
    if (d.hint) out.hint = d.hint
    if (d.stack && !out.stack) out.stack = d.stack
  }
  out.build = BUILD
  out.route = typeof location !== 'undefined' ? location.pathname : null
  out.online = typeof navigator !== 'undefined' && 'onLine' in navigator ? navigator.onLine : null
  out.visible = typeof document !== 'undefined' ? document.visibilityState : null
  out.sinceLoadMs = sinceLoadMs()
  out.breadcrumbs = getBreadcrumbs().slice(-BREADCRUMBS_PER_ROW)
  return out
}

// A repeat of the same kind+message inside the window is not sent again.
export function shouldSend(kind, message, now = Date.now()) {
  const key = kind + '|' + message
  const last = recent.get(key)
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return false
  recent.set(key, now)
  if (recent.size > 200) recent.delete(recent.keys().next().value)
  return true
}

// Is there budget left in the rolling window? Spends one unit when there is.
export function takeBudget(now = Date.now()) {
  while (sentAt.length && now - sentAt[0] > BUDGET_WINDOW_MS) sentAt.shift()
  if (sentAt.length >= MAX_PER_SESSION) return false
  sentAt.push(now)
  return true
}

// Reset the per-session state (used by tests).
export function _resetLogBudget() { sentAt.length = 0; recent.clear(); queue.length = 0 }
export function _queuedRows() { return queue.slice() }

async function deliver(row) {
  const { error } = await supabase.from('client_errors').insert(row)
  if (error) throw error
}

function enqueue(row) {
  if (queue.length >= MAX_QUEUED) queue.shift()
  queue.push(row)
}

// Retry anything that couldn't be delivered (called on the 'online' event).
// Stops at the first failure so a still-dead link doesn't churn.
export async function flushQueue() {
  while (queue.length) {
    try { await deliver(queue[0]); queue.shift() } catch { break }
  }
}

// logError(kind, messageOrError, context?)
//   `messageOrError` may be a string OR the error itself — passing the error
//   is better (code/status/hint/stack come along). `kind` is the category the
//   Diagnostics screen groups by: render | rejection | error | fetch | write |
//   auth | push | timeout | test.
export async function logError(kind, messageOrError, context) {
  try {
    const isErr = messageOrError !== null && typeof messageOrError === 'object'
    const msg = isErr ? describeError(messageOrError).message : String(messageOrError ?? 'Unknown error')
    const ctx = enrichContext(context, isErr ? messageOrError : undefined)
    if (import.meta.env?.DEV && !import.meta.env?.TEST) console.warn(`[mvf:${kind}]`, msg, ctx)
    if (!shouldSend(kind, msg)) return
    if (!takeBudget()) return
    breadcrumb('error', `${kind}: ${msg}`)
    let profileId = null
    try { profileId = (await supabase.auth.getSession()).data.session?.user?.id ?? null } catch { /* ignore */ }
    const row = buildErrorRow({
      kind, message: msg, context: ctx, profileId,
      url: typeof location !== 'undefined' ? location.pathname + location.search : null,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    })
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { enqueue(row); return }
    try { await deliver(row) } catch (e) { if (isNetworkError(e)) enqueue(row) }
  } catch {
    /* logging must never throw */
  }
}

// A cross-origin error is sanitised by the browser to a bare "Script error."
// with no file/line and no Error object — almost always a browser extension or
// a third-party script, never our (same-origin) code. There's nothing
// actionable, so we don't log it (it would just be noise in Diagnostics).
export function isActionableWindowError(e) {
  if (e?.error) return true // a real Error object → same-origin, has a stack
  const m = e?.message
  return !!m && m !== 'Script error.' && m !== 'Script error'
}

// Browser-generated noise with nothing actionable in it: a background
// service-worker update check fails whenever the phone is offline, and those
// rejections were ~80% of the live error log — drowning the real failures.
export function isNoiseError(message) {
  return /Failed to update a ServiceWorker/i.test(String(message ?? ''))
}

// Attach global handlers once (uncaught errors + unhandled promise rejections),
// plus the connectivity/visibility breadcrumbs that give every row its context.
export function installGlobalErrorLogging() {
  if (typeof window === 'undefined' || window.__mvfErrLog) return
  window.__mvfErrLog = true
  window.addEventListener('error', (e) => {
    if (!isActionableWindowError(e)) return
    const msg = e?.error?.message || e?.message || 'window.error'
    if (isNoiseError(msg)) return
    logError('error', e?.error ?? msg, { source: e?.filename, line: e?.lineno })
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e?.reason
    const msg = describeError(r).message
    if (isNoiseError(msg)) return
    logError('rejection', r ?? 'unhandledrejection')
  })
  window.addEventListener('online', () => { breadcrumb('net', 'online'); flushQueue() })
  window.addEventListener('offline', () => breadcrumb('net', 'offline'))
  document.addEventListener('visibilitychange', () => breadcrumb('app', document.visibilityState))
  breadcrumb('app', 'start', { build: BUILD })
}
