// One shape for the many error shapes we meet: a thrown Error, a DOMException
// (TimeoutError/AbortError from the fetch ceiling), a PostgrestError / AuthError
// / StorageError resolved as `{ error }`, or a bare string. describeError feeds
// the client error log (so a row carries code/status/hint, not just a message);
// friendlyError turns the same thing into a line a player can act on.

export function describeError(e) {
  if (e == null) return { name: 'Unknown', message: 'Unknown error', code: null, status: null, details: null, hint: null, stack: null }
  if (typeof e === 'string') return { name: 'Error', message: e, code: null, status: null, details: null, hint: null, stack: null }
  if (typeof e !== 'object' && typeof e !== 'function') {
    return { name: typeof e, message: String(e), code: null, status: null, details: null, hint: null, stack: null }
  }
  // A Supabase response object handed over whole ({ data, error }).
  if (e.error && typeof e.error === 'object' && !e.message) return describeError(e.error)
  const raw = e.message ?? e.error_description ?? e.msg ?? e.error ?? null
  const message = raw != null && raw !== '' ? String(raw) : safeString(e)
  // A plain `{ message, code }` object (how supabase-js resolves errors) is
  // just an Error for our purposes; a real class keeps its name.
  const ctorName = e.constructor && e.constructor !== Object ? e.constructor.name : null
  return {
    name: String(e.name ?? ctorName ?? 'Error'),
    message: message.slice(0, 1000),
    code: e.code ?? e.error_code ?? null,
    status: numberOrNull(e.status ?? e.statusCode),
    details: e.details ? String(e.details).slice(0, 500) : null,
    hint: e.hint ? String(e.hint).slice(0, 300) : null,
    stack: typeof e.stack === 'string' ? e.stack : null,
  }
}

function numberOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null }

function safeString(e) {
  try {
    const s = typeof e.toString === 'function' && e.toString !== Object.prototype.toString ? e.toString() : JSON.stringify(e)
    return s && s !== '{}' ? s : 'Unknown error'
  } catch { return 'Unknown error' }
}

// The browser gave up on the request (or never got an answer). Retryable.
export function isNetworkError(e) {
  const d = describeError(e)
  if (d.name === 'TimeoutError' || d.name === 'AbortError') return true
  return /load failed|failed to fetch|networkerror|network request failed|timed out|connection appears to be offline|ERR_INTERNET_DISCONNECTED/i.test(d.message)
}

// The device clock is wrong: the server-issued token looks like it's from the
// future. Refreshing never fixes it — the phone's clock has to.
export function isClockSkew(e) {
  return /issued at future|token used before issued|iat/i.test(describeError(e).message)
}

// The session is dead or unusable: refresh/sign in again rather than retry.
export function isAuthStale(e) {
  const d = describeError(e)
  if (d.code === 'PGRST301') return true
  return /jwt expired|invalid jwt|invalid token|refresh_token_not_found|refresh token not found|session.*(expired|missing)/i.test(d.message)
}

export function isPermissionDenied(e) {
  const d = describeError(e)
  return d.code === '42501' || /row-level security|permission denied/i.test(d.message)
}

// Plain-English, club-voice line for a Toast. Falls back to `fallback`, then
// to the raw message so nothing is ever silently swallowed.
export function friendlyError(e, fallback) {
  const d = describeError(e)
  if (isClockSkew(e)) return "Your phone's clock looks wrong — set it to update automatically, then try again."
  if (isNetworkError(e)) return "Couldn't reach the server — check your signal and give it another go."
  if (isAuthStale(e)) return 'Your sign-in has gone stale — sign out and back in.'
  if (isPermissionDenied(e)) return "You're not allowed to do that."
  switch (d.code) {
    case '23505': return "That one's already in — looks like a duplicate."
    case '23503': return "That's still linked to something else — sort that first."
    case '23502':
    case '23514':
    case '22P02': return "Something's missing or not right — check the form and try again."
    case 'PGRST116': return "Couldn't find that one — it may have been removed."
    default: break
  }
  if (/invalid login credentials/i.test(d.message)) return 'Wrong email or password.'
  if (/email not confirmed/i.test(d.message)) return 'Confirm your email first — check your inbox.'
  if (/already (been )?registered/i.test(d.message)) return "There's already an account with that email."
  if (d.status === 429 || /rate limit|too many requests/i.test(d.message)) return 'Steady on — give it a minute and try again.'
  if (d.status === 413 || /too large|exceeded the maximum allowed size/i.test(d.message)) return "That file's too big — try a smaller photo."
  if (d.status != null && d.status >= 500) return 'The server had a wobble — try again in a moment.'
  return fallback ?? (d.message && d.message !== 'Unknown error' ? d.message : 'Something went wrong — try again.')
}
