// Session breadcrumb trail: a small ring buffer of what the app was doing just
// before something went wrong. logger.js attaches the tail of it to every
// client_errors row, so a bare "TypeError: Load failed" arrives with the route,
// the last few failed/slow requests and the player's last taps. Deliberately
// import-free — supabase.js and logger.js both depend on it.

export const MAX_BREADCRUMBS = 30

const trail = []
const t0 = Date.now()

// Record one crumb. `data` is optional and must be small + JSON-safe.
export function breadcrumb(category, message, data) {
  const crumb = {
    t: Date.now() - t0,
    c: String(category ?? 'app').slice(0, 20),
    m: String(message ?? '').slice(0, 160),
  }
  if (data !== undefined) crumb.d = data
  trail.push(crumb)
  if (trail.length > MAX_BREADCRUMBS) trail.splice(0, trail.length - MAX_BREADCRUMBS)
  return crumb
}

export function getBreadcrumbs() { return trail.slice() }
export function clearBreadcrumbs() { trail.length = 0 }
export function sinceLoadMs() { return Date.now() - t0 }
