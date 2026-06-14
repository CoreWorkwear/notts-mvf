// British formatting helpers. Dates read the UK way; times are 24h.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Local YYYY-MM-DD for "today" (don't use toISOString — that's UTC).
export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Parse a 'YYYY-MM-DD' as a local date (avoids TZ shifting the day).
export function parseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// "Sun 22 Jun"
export function fmtDate(iso) {
  const d = parseDate(iso)
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

// "Sun 22 June" (longer, for heroes)
export function fmtDateLong(iso) {
  const d = parseDate(iso)
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS_FULL[d.getMonth()]}`
}

// 'HH:MM:SS' or 'HH:MM' -> 'HH:MM'
export function fmtKO(time) {
  if (!time) return ''
  return time.slice(0, 5)
}

// "in 3 days", "today", "tomorrow", "2 days ago"
export function relativeWhen(iso) {
  const today = parseDate(todayISO())
  const target = parseDate(iso)
  const days = Math.round((target - today) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  if (days > 1) return `in ${days} days`
  return `${Math.abs(days)} days ago`
}

// --- Match lifecycle timing (always reckoned in UK / Europe-London time) -----
// Fixtures store a wall-clock date + kickoff entered in London time. We compare
// against "now" also read as London wall-clock, so GMT/BST is handled correctly
// without any manual offset maths.
function londonNowParts() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const get = (t) => Number(parts.find((p) => p.type === t).value)
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute') }
}

// Comparable nominal-instant for the current London wall-clock.
function londonNowMs() {
  const n = londonNowParts()
  return Date.UTC(n.y, n.mo - 1, n.d, n.h, n.mi)
}

// True once kickoff has passed (London time).
export function hasKickedOff(matchDate, kickoff) {
  const [y, mo, d] = matchDate.split('-').map(Number)
  const [h, mi] = (kickoff || '00:00').split(':').map(Number)
  return londonNowMs() >= Date.UTC(y, mo - 1, d, h, mi)
}

// A game is "concluded" (drops out of Fixtures into Results) once kickoff + N
// hours has passed. Default 4h covers an 11-a-side game plus slack.
export function fixtureConcluded(matchDate, kickoff, hoursAfter = 4) {
  const [y, mo, d] = matchDate.split('-').map(Number)
  const [h, mi] = (kickoff || '00:00').split(':').map(Number)
  const endMs = Date.UTC(y, mo - 1, d, h, mi) + hoursAfter * 3600 * 1000
  return londonNowMs() >= endMs
}

export { MONTHS, MONTHS_FULL, DAYS }
