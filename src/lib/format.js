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

export { MONTHS, MONTHS_FULL, DAYS }
