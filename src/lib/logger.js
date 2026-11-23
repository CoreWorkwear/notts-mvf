import { supabase } from './supabase'
import { breadcrumb, clearBreadcrumbs, getBreadcrumbs, sinceLoadMs } from './breadcrumbs'
import { describeError, isNetworkError, isPermissionDenied } from './errors'

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
// Postgres echoes the whole offending row (names, phone, dob…) after this
// phrase on a check/not-null violation. Redact from the open paren to the end
// of the line — the closing paren may be missing when the text was truncated.
const FAILING_ROW_RE = /Failing row contains \(.*/g
// A phone number as people write one: starts with +, 0 or (0, holds 10-15
// digits (spaces, hyphens and brackets allowed between), and isn't glued to a
// letter, digit, dot, plus or hyphen on either side. "Any 7+ digits" was too
// greedy: it ate an all-digit git sha in the build stamp (0.1.0+9043233), all-
// digit pieces of uuids, and millisecond timestamps. Same rule as
// supabase/functions/_shared/log.js.
const PHONE_RE = /(?<![\w.+-])(?:\+|\(?0)[\d\s\-()]*\d(?![\w-])/g
const maskPhone = (m) => { const n = m.replace(/\D/g, '').length; return n >= 10 && n <= 15 ? '[phone]' : m }

function scrubString(str) {
  return str
    .replace(JWT_RE, '[jwt]')
    .replace(EMAIL_RE, '[email]')
    .replace(FAILING_ROW_RE, 'Failing row contains ([redacted])')
    .replace(PHONE_RE, maskPhone)
}

export function scrub(value, depth = 0, seen = new WeakSet()) {
  if (depth > 6) return '[deep]'
  if (typeof value === 'string') return scrubString(value)
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

// Sign-out hygiene: the offline queue and the breadcrumb trail belong to the
// person who just left. The next user on this device must not have their rows
// carry (or flush) the previous user's trail.
export function resetLogState() { queue.length = 0; clearBreadcrumbs() }

// The database looked at this row and refused it (a 4xx, an RLS denial, a
// check violation). Retrying can never change the answer, so flushQueue drops
// it instead of stalling every row behind it for ever.
export function isRejectedByDb(e) {
  const d = describeError(e)
  if (isNetworkError(e)) return false
  if (isPermissionDenied(e) || d.code === '23514') return true
  return d.status != null && d.status >= 400 && d.status < 500 && d.status !== 408 && d.status !== 429
}

async function deliver(row) {
  const { error } = await supabase.from('client_errors').insert(row)
  if (error) throw error
}

function enqueue(row) {
  if (queue.length >= MAX_QUEUED) queue.shift()
  queue.push(row)
}

// Retry anything that couldn't be delivered (called on the 'online' event).
// Stops at the first NETWORK failure so a still-dead link doesn't churn; a row
// the database itself rejects is dropped (not re-logged) so it can't block the
// rows behind it.
export async function flushQueue() {
  while (queue.length) {
    const row = queue[0]
    try { await deliver(row); queue.shift() } catch (e) {
      if (isRejectedByDb(e)) { if (queue[0] === row) queue.shift(); continue }
      break
    }
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
