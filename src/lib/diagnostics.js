// Pure helpers behind the admin Diagnostics screen.

// Collapse the raw client_errors rows into one card per distinct problem
// (kind + message), newest-last-seen first, so 40 rows of the same "Load
// failed" read as one line with a count rather than a wall.
export function groupErrors(rows) {
  const groups = new Map()
  for (const r of rows ?? []) {
    const key = `${r.kind}|${r.message}`
    let g = groups.get(key)
    if (!g) {
      g = { key, kind: r.kind, message: r.message, count: 0, first: r.created_at, last: r.created_at, urls: new Set(), builds: new Set(), rows: [] }
      groups.set(key, g)
    }
    g.count++
    if (r.created_at < g.first) g.first = r.created_at
    if (r.created_at > g.last) g.last = r.created_at
    if (r.url) g.urls.add(r.url)
    if (r.context?.build) g.builds.add(r.context.build)
    g.rows.push(r)
  }
  return [...groups.values()]
    .map((g) => ({ ...g, urls: [...g.urls], builds: [...g.builds], rows: g.rows.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1)) }))
    .sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0))
}

// The distinct kinds present, in a stable order (the known ones first).
const KIND_ORDER = ['render', 'error', 'rejection', 'fetch', 'write', 'auth', 'push', 'timeout', 'test']
export function kindsOf(rows) {
  const present = new Set((rows ?? []).map((r) => r.kind).filter(Boolean))
  return [...KIND_ORDER.filter((k) => present.has(k)), ...[...present].filter((k) => !KIND_ORDER.includes(k)).sort()]
}

// "3 min ago" / "2 h ago" / "4 d ago" — the log reads by recency.
export function fmtAgo(iso, now = Date.now()) {
  const ms = now - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'just now'
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.floor(h / 24)} d ago`
}

// A one-line summary of a breadcrumb for the expanded row view.
export function fmtCrumb(c) {
  const t = (c.t / 1000).toFixed(1).padStart(6, ' ')
  const d = c.d !== undefined ? ' ' + safeJson(c.d) : ''
  return `${t}s  ${c.c.padEnd(6, ' ')} ${c.m}${d}`
}

function safeJson(v) { try { return JSON.stringify(v) } catch { return '' } }

// "iPhone · Safari" — enough to tell an iOS Safari quirk from an Android one
// without printing the whole user-agent string.
export function shortUA(ua) {
  const s = String(ua ?? '')
  if (!s) return '—'
  const device = /iPhone/.test(s) ? 'iPhone' : /iPad|Macintosh.*Mobile/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows' : /Macintosh/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : 'other'
  const browser = /Edg\//.test(s) ? 'Edge' : /CriOS|Chrome\//.test(s) ? 'Chrome' : /FxiOS|Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'browser'
  return `${device} · ${browser}`
}
