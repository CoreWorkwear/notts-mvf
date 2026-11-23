import { fmtDate, parseDate } from './format'

export const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const recurrenceUnits = ['day', 'week', 'month', 'year']
export const maxInterval = 52
export const maxSessions = 500

export function isoWeekday(date) {
  return parseDate(date).getDay() || 7
}

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(value)
}

// Preview calendar dates independently of the phone's time zone. The server
// validates the same rule when it creates the sessions in one transaction.
function* occurrences(start, rule) {
  const anchor = new Date(start + 'T00:00:00Z')
  if (rule.frequency === 'week') {
    const monday = anchor.getUTCDate() - ((anchor.getUTCDay() + 6) % 7)
    for (let week = 0; ; week += rule.interval) {
      for (const weekday of rule.weekdays) {
        const date = new Date(anchor)
        date.setUTCDate(monday + 7 * week + weekday - 1)
        if (date >= anchor) yield date
      }
    }
  }
  for (let step = 0; ; step += rule.interval) {
    const date = new Date(anchor)
    if (rule.frequency === 'day') date.setUTCDate(anchor.getUTCDate() + step)
    if (rule.frequency === 'month') date.setUTCMonth(anchor.getUTCMonth() + step)
    if (rule.frequency === 'year') date.setUTCFullYear(anchor.getUTCFullYear() + step)
    // JS carries 31 February into March. A calendar series skips that month.
    if (rule.frequency === 'day' || date.getUTCDate() === anchor.getUTCDate()) yield date
  }
}

export function previewRecurrence(start, rule) {
  if (!isCalendarDate(start)) return { error: 'Choose a valid start date.' }
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > maxInterval) {
    return { error: `Choose an interval from 1 to ${maxInterval}.` }
  }
  if (rule.frequency === 'week' && !rule.weekdays.length) return { error: 'Choose at least one weekday.' }
  if (rule.count !== null && (!Number.isInteger(rule.count) || rule.count < 1 || rule.count > maxSessions)) {
    return { error: `Choose from 1 to ${maxSessions} sessions.` }
  }
  if (rule.count === null && (!isCalendarDate(rule.until) || rule.until < start)) {
    return { error: 'Choose an end date on or after the start date.' }
  }
  const end = rule.until && new Date(rule.until + 'T00:00:00Z')
  let firstDate
  let sessionCount = 0
  for (const date of occurrences(start, rule)) {
    if (end && date > end) break
    firstDate ??= date.toISOString().slice(0, 10)
    if (rule.count !== null) return { firstDate, sessionCount: rule.count }
    sessionCount += 1
    if (sessionCount > maxSessions) return { error: `Choose an earlier end date. A series can contain up to ${maxSessions} sessions.` }
  }
  if (!firstDate) return { error: 'No selected weekday falls in this date range.' }
  return { firstDate, sessionCount }
}

export function recurrenceSummary(start, time, rule, preview) {
  if (preview.error) return ''
  const { interval, frequency } = rule
  let pattern = interval === 1 ? `Every ${frequency}` : `Every ${interval} ${frequency}s`
  const date = parseDate(start)
  if (frequency === 'week') pattern += ' on ' + rule.weekdays.map(day => weekdayNames[day - 1].slice(0, 3)).join(', ')
  if (frequency === 'month') pattern += ` on day ${date.getDate()}`
  if (frequency === 'year') pattern += ' on ' + date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
  const details = [pattern, time, `${preview.sessionCount} ${preview.sessionCount === 1 ? 'session' : 'sessions'}`]
  if (preview.firstDate !== start) details.push(`From ${fmtDate(preview.firstDate)} ${preview.firstDate.slice(0, 4)}`)
  if (rule.until) details.push(`Through ${fmtDate(rule.until)} ${rule.until.slice(0, 4)}`)
  if (frequency === 'month' && date.getDate() > 28) details.push('Skip months without this date')
  if (frequency === 'year' && date.getMonth() === 1 && date.getDate() === 29) details.push('Leap years only')
  return details.filter(Boolean).join(' · ')
}
