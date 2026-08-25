import { supabase } from './supabase'

// Self-hosted client error logging. logError() is best-effort: it must NEVER
// throw (or it could loop), and it's rate-limited per session so a misbehaving
// component can't flood the table. buildErrorRow is pure for unit testing.

export const MAX_PER_SESSION = 30
let sent = 0

// Serialise context defensively — drop anything circular/unserialisable.
function safeContext(context) {
  if (!context) return null
  try { return JSON.parse(JSON.stringify(context)) } catch { return { note: 'context unserialisable' } }
}

export function buildErrorRow({ kind, message, context, profileId = null, clubId = null, url = null, userAgent = null }) {
  return {
    kind: String(kind || 'error').slice(0, 40),
    message: String(message ?? 'Unknown error').slice(0, 1000),
    context: safeContext(context),
    url: url ? String(url).slice(0, 500) : null,
    user_agent: userAgent ? String(userAgent).slice(0, 500) : null,
    profile_id: profileId,
    club_id: clubId,
  }
}

// Reset the per-session counter (used by tests).
export function _resetLogBudget() { sent = 0 }

export async function logError(kind, message, context) {
  try {
    if (sent >= MAX_PER_SESSION) return
    sent++
    let profileId = null
    try { profileId = (await supabase.auth.getSession()).data.session?.user?.id ?? null } catch { /* ignore */ }
    const row = buildErrorRow({
      kind, message, context, profileId,
      url: typeof location !== 'undefined' ? location.pathname + location.search : null,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    })
    await supabase.from('client_errors').insert(row)
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

// Attach global handlers once (uncaught errors + unhandled promise rejections).
export function installGlobalErrorLogging() {
  if (typeof window === 'undefined' || window.__mvfErrLog) return
  window.__mvfErrLog = true
  window.addEventListener('error', (e) => {
    if (!isActionableWindowError(e)) return
    const msg = e?.error?.message || e?.message || 'window.error'
    if (isNoiseError(msg)) return
    logError('error', msg, { stack: e?.error?.stack, source: e?.filename, line: e?.lineno })
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e?.reason
    const msg = r?.message || String(r) || 'unhandledrejection'
    if (isNoiseError(msg)) return
    logError('rejection', msg, { stack: r?.stack })
  })
}
