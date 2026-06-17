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

// Attach global handlers once (uncaught errors + unhandled promise rejections).
export function installGlobalErrorLogging() {
  if (typeof window === 'undefined' || window.__mvfErrLog) return
  window.__mvfErrLog = true
  window.addEventListener('error', (e) => {
    logError('error', e?.message || 'window.error', { source: e?.filename, line: e?.lineno })
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e?.reason
    logError('rejection', r?.message || String(r) || 'unhandledrejection', { stack: r?.stack })
  })
}
